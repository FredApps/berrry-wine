  ;; ======================================================================
  ;; 07c-block-exec.wat -- a per-BLOCK executor for every basic block.
  ;;
  ;; docs/block-executor-design.md is the design; this is the prototype it
  ;; describes. Default OFF ($block_exec_enabled), decode-time gate.
  ;;
  ;; The claim being tested, from docs/dispatch-attribution-2026-09.md: the
  ;; per-op `call_indirect` is 18-19% of guest CPU and the $get_reg/$set_reg
  ;; br_table register file another 8-12%, on three apps whose blocks are 3.5,
  ;; 4.3 and 7.0 ops long. Holding the eight GPRs in wasm LOCALS for the length
  ;; of one block deletes the second outright and most of the first, and
  ;; docs/region-descriptor-bench-2026-09.md measured that mechanism at
  ;; +29..46% on straight-line blocks of 2 to 32 ops with no crossover.
  ;;
  ;; Two structural decisions, both argued in the design doc:
  ;;
  ;;   1. THE TERMINATOR STAYS THREADED. The descriptor covers ops [0, n-1) and
  ;;      the block's real terminator is re-emitted after it, untouched. That
  ;;      keeps $decode_run's fall-through adjacency alive (it reads the last
  ;;      OP_INDEX entry and requires optr + 16 == d_block_end), keeps
  ;;      $page_retire_at's 8-byte stamp landing on the block's first op, and
  ;;      means call/ret/loop/jecxz/far-jmp/H404/H407 need no executor code at
  ;;      all. Cost: one dispatch per block. A block of N ops goes N -> 2.
  ;;
  ;;   2. UNIMPLEMENTED OPS RUN THE REAL HANDLER. Registers spill to the
  ;;      globals, the handler is called, the registers reload. Every $th_* ends
  ;;      in `return_call $next`, so the copied words are followed by an op
  ;;      naming $th_bx_resume (H459), whose empty body returns -- and because
  ;;      the whole chain is tail calls, that return lands back in THIS frame.
  ;;      The fallback share is the migration progress meter.
  ;;
  ;; The micro-op encoding is H454's ($TU_* in 07b-loop-match.wat) and so is the
  ;; classifier ($tree_uop_classify). There is one encoding and one classifier;
  ;; what this file adds is a second EXECUTOR, which exists only because a wasm
  ;; local cannot cross a function boundary -- the exact property the design
  ;; exploits. See OPEN-2 in the design doc.
  ;; ======================================================================

  ;; Decode-time gate. OFF, and no app path sets it.
  (global $block_exec_enabled (mut i32) (i32.const 0))
  ;; Below this many body micro-ops the H458 dispatch is not repaid. Argued,
  ;; not measured -- OPEN-8.
  ;; The install FLOOR, and it is a measured crossover, not a taste. A
  ;; descriptor pays a fixed entry/exit cost (park $steps, run the loop, publish
  ;; eight GPRs and $ea_temp, recompute $steps) against a saving that is
  ;; per-micro-op, so it only wins once the block is long enough. From
  ;; `tools/bench-loops.js --toggle=block_exec` (7 interleaved reps, minima):
  ;; blk2 -1.9%, blk4 +4.7%, blk8 -0.9%, blk16 +22.0%, blk32 +36.2%. Heroes II
  ;; at a floor of 2 is a *resolved loss* of 0.36s on 3.08s (its blocks are
  ;; short and 37% of its ops fall back); at 12 the same A/B is unresolvable,
  ;; and MW3 at 12 is a resolved gain of 0.40s on 8.54s. Lower it with
  ;; --block-exec-min-uops for a correctness sweep, where coverage is the point.
  ;; 0 means "decide with the cost model" (the default). A nonzero value is the
  ;; old hard uop-count floor, kept verbatim so every A/B command already
  ;; written down keeps meaning what it meant.
  (global $block_exec_min_uops (mut i32) (i32.const 0))
  ;; A DEBUG knob, 0 = no ceiling. Paired with the floor above it turns the
  ;; installer into a one-size sieve, which is how a divergence gets bisected
  ;; down to a single block shape without an instrumented build: walk the
  ;; window until the app breaks, then log the entry EIPs inside it. Quake II's
  ;; 8-uop blocks were found this way.
  (global $block_exec_max_uops (mut i32) (i32.const 0))
  ;; --trace-block-exec: log every installed descriptor as
  ;;   0xBE000000, entry_eip, nuops, then (kind, original handler) per uop.
  ;; The marker word is there so the stream survives being interleaved with
  ;; every other $host_log_i32 caller. Pair it with the min/max sieve above:
  ;; the two together name the exact block behind a divergence, and finding
  ;; one without them means reading a 3000-batch trace instead.
  (global $block_exec_trace (mut i32) (i32.const 0))

  ;; Meters. The native/fallback split is the fraction of the 19-23% ceiling
  ;; collected so far, per app, and names the opcode to migrate next.
  (global $block_exec_installs (mut i32) (i32.const 0))
  (global $block_exec_declines (mut i32) (i32.const 0))
  (global $block_exec_runs (mut i32) (i32.const 0))
  (global $block_exec_native_ops (mut i64) (i64.const 0))
  (global $block_exec_fallback_ops (mut i64) (i64.const 0))
  ;; Interior block edges the region did not have to take. Together with the
  ;; run count this is the whole cost model -- ns/entry against ns/op -- and it
  ;; is the one term no histogram can recover, because a folded edge leaves no
  ;; trace anywhere else.
  (global $block_exec_transfers_saved (mut i64) (i64.const 0))
  ;; One sample, not a histogram: the handler index of the most recent op that
  ;; had to take the fallback. Enough to name the family to widen first.
  (global $block_exec_last_fallback_fn (mut i32) (i32.const -1))
  ;; Why the most recent block declined. 1 too short, 2 poisoned/16-bit/fault,
  ;; 3 an unsafe op in the body, 4 past the emit slack, 5 past the scratch.
  (global $block_exec_decl_why (mut i32) (i32.const 0))

  (global $BX_HANDLER i32 (i32.const 458))
  (global $BX_RESUME_HANDLER i32 (i32.const 459))
  (global $BX_UOP_WORDS i32 (i32.const 6))
  (global $BX_HEADER_WORDS i32 (i32.const 4))

  ;; Micro-op kinds are the $TU_* space from 07b-loop-match.wat, used
  ;; directly -- there is no second, denser numbering any more. What this file
  ;; adds are the four kinds the loop matcher never needed, appended above
  ;; 07b's last kind (53) so both matchers emit into one vocabulary.
  (global $TU_PUSH_R   i32 (i32.const 54))  ;; [--esp] = R[d]
  (global $TU_POP_R    i32 (i32.const 55))  ;; R[d] = [esp++]
  (global $TU_PUSH_I   i32 (i32.const 56))  ;; [--esp] = imm
  ;; The escape hatch: run the op's real handler with the register file
  ;; spilled and reloaded around it. `a` is the handler index, `imm` its operand
  ;; word, `b` the byte offset of its inline words in the trailing fallback
  ;; pool. One of these costs far more than a threaded dispatch, so the install
  ;; cost model prices them explicitly rather than counting them as coverage.
  (global $TU_FALLBACK i32 (i32.const 57))
  (global $TU_MAX_KIND i32 (i32.const 57))

  ;; ----------------------------------------------------------------------
  ;; Decode-time helpers
  ;; ----------------------------------------------------------------------

  ;; "This handler ends a block, or can set $eip." Such an op is legal as the
  ;; block's TERMINATOR (which stays threaded and is never our problem) and is
  ;; a hard decline anywhere in the body, because the executor resumes at the
  ;; next micro-op unconditionally and would run past a taken branch.
  ;;
  ;; Handlers that merely set $yield_flag / $yield_reason are NOT here: the
  ;; threaded path does not stop for them between two ops of one block either,
  ;; so excluding them would make the two arms differ rather than agree.
  (func $bx_op_unsafe (param $fn i32) (result i32)
    ;; CALL / RET / JMP / Jcc / $th_block_end / LOOP
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 39))
                 (i32.le_u (local.get $fn) (i32.const 46)))
      (then (return (i32.const 1))))
    ;; the sixteen specialised Jcc
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 307))
                 (i32.le_u (local.get $fn) (i32.const 322)))
      (then (return (i32.const 1))))
    ;; fused terminators and the storm bitreader
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 391))
                 (i32.le_u (local.get $fn) (i32.const 396)))
      (then (return (i32.const 1))))
    ;; Every loop/region super-op -- 418 and up is where the folds live, and a
    ;; fold runs a whole loop and lands EIP wherever the loop exits.
    ;;
    ;; Two ordinary handlers were shelved in that range as it grew, and they
    ;; are ORDINARY: H420 is a plain `MOV [base+idx*s+disp], r32` the decoder
    ;; emits from a single instruction, and H421 is the two-instruction
    ;; load/store pair fused. Neither touches EIP. Excluding them cost more
    ;; than it sounds: a dword SIB store is the write half of nearly every
    ;; indexed loop body, so the blanket declined the exact blocks this
    ;; executor exists for. Anything else new above 418 must be added here
    ;; deliberately, which is the right default for a range whose meaning is
    ;; "a fold unless stated otherwise".
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 418))
                 (i32.eqz (i32.or (i32.eq (local.get $fn) (i32.const 420))
                                  (i32.eq (local.get $fn) (i32.const 421)))))
      (then (return (i32.const 1))))
    ;; The three x87 handlers, 188..190. Not because they set $eip -- they do
    ;; not -- but because the x87 fusers ($x87_fuse_block and friends) run
    ;; AFTER this matcher and rewrite an op IN PLACE, leaving the ops it
    ;; absorbed in the stream as inline data with stale OP_INDEX entries. A
    ;; block claimed here never reaches them, so an x87 block would silently
    ;; lose its fusion AND take the expensive fallback for every one of its
    ;; x87 ops. Standing down is both correct and faster. Widening the
    ;; executor to the x87 micro-op kinds H454 already has is OPEN-6.
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 188))
                 (i32.le_u (local.get $fn) (i32.const 190)))
      (then (return (i32.const 1))))
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $fn) (i32.const 120))
                (i32.eq (local.get $fn) (i32.const 125)))
        (i32.or (i32.eq (local.get $fn) (i32.const 141))
                (i32.eq (local.get $fn) (i32.const 216))))
      (i32.or
        (i32.or
          (i32.or (i32.eq (local.get $fn) (i32.const 355))
                  (i32.eq (local.get $fn) (i32.const 361)))
          (i32.or (i32.eq (local.get $fn) (i32.const 368))
                  (i32.eq (local.get $fn) (i32.const 370))))
        (i32.or
          (i32.or (i32.eq (local.get $fn) (i32.const 381))
                  (i32.eq (local.get $fn) (i32.const 382)))
          (i32.or (i32.eq (local.get $fn) (i32.const 404))
                  (i32.eq (local.get $fn) (i32.const 407)))))))


  ;; ----------------------------------------------------------------------
  ;; Cost model (OPEN-7). The install decision used to be "does this block have
  ;; at least N micro-ops", a proxy that gets the two things that actually
  ;; matter backwards: a fallback micro-op is SLOWER than the threaded op it
  ;; replaces (a spill and reload of the whole register file around an indirect
  ;; call), and a folded interior edge is worth more than a micro-op. Counting
  ;; uops charges nothing for the first and credits nothing for the second.
  ;;
  ;; So price it instead, in nanoseconds, from numbers the bench measured:
  ;; a threaded micro-op is ~38ns and the same op inside the executor ~22ns
  ;; (docs/region-descriptor-bench-2026-09.md section 4), and a block transfer
  ;; is ~9ns on top of its dispatch (tools/bench-loops.js nop_chain/jmp_chain).
  ;; Every term is known at decode time.
  ;;
  ;; $BX_C_ENTRY is calibrated, not measured: it is set so that the plain
  ;; one-block no-fallback case -- the only shape with an empirical answer --
  ;; reproduces the floor of 12 that docs/block-executor-design.md OPEN-8
  ;; settled by bisection. Anything the microbench cannot see about entry cost
  ;; (the eight register materializations, the header parse, the extra live
  ;; range V8 has to allocate) is therefore inside this one number.
  ;; Entry cost in ns. Calibrated against tools/bench-loops.js on the MERGED
  ;; executor, not the pre-merge one: at 100 (breakeven ~7 native uops) the
  ;; 9-uop shapes install and LOSE -3.2% (blk8), -12.2% (blk_mem8), -8.5%
  ;; (blk_fb8), while blk16 wins +5.7% and blk32 +19.4%. So the real breakeven
  ;; sits between 9 and 16 native uops; 190/16 = 11.9 lands inside that window
  ;; and declines exactly the shapes that measured as losses.
  (global $BX_C_ENTRY    i32 (i32.const 190))
  (global $BX_C_UOP      i32 (i32.const 16))
  (global $BX_C_TRANSFER i32 (i32.const 9))
  (global $BX_C_FALLBACK i32 (i32.const 20))

  ;; Where the descriptor is BUILT. Writing it forward from $tstart would
  ;; overwrite the very ops still being read -- a 24-byte micro-op over an
  ;; 8-byte op clobbers on the third instruction -- so it is assembled in the
  ;; far half of OP_INDEX (the same scratch $loop_try_tree_fold uses, and never
  ;; at the same time) and copied out once the whole block has been accepted.
  ;;
  ;; That half is split again: micro-ops forward from the bottom, the fallback
  ;; pool forward from the middle. Two cursors rather than one because the pool
  ;; is variable-length and the micro-op array must not be.
  (func $bx_scratch (result i32)
    (i32.add (global.get $OP_INDEX) (i32.shr_u (global.get $OP_INDEX_SIZE) (i32.const 1))))
  (func $bx_scratch_words (result i32)
    (i32.shr_u (global.get $OP_INDEX_SIZE) (i32.const 3)))

  ;; ======================================================================
  ;; THE MULTI-BLOCK MATCHER (OPEN-2)
  ;;
  ;; Everything above builds a ONE-block descriptor. The executor has always
  ;; been able to run N, and docs/region-census-2026-09.md measured that 43.6%
  ;; of retired guest ops on a six-app corpus sit inside a 2-4 block region and
  ;; 4.4% inside a 5-16 block one. This is what builds those descriptors from
  ;; real code.
  ;;
  ;; WHERE THE BLOCKS COME FROM, and why there is no second decoder. A region
  ;; needs the micro-ops of several blocks at once, and a block's micro-ops
  ;; only exist for the instant between $decode_block emitting it and the next
  ;; $decode_block overwriting OP_INDEX. $decode_run already walks exactly the
  ;; set of blocks this wants -- the fall-through chain out of one entry, in
  ;; ascending guest address, inside one page, stopping at anything already
  ;; compiled -- so the matcher rides along with it:
  ;;
  ;;   $decode_run(eip)      -> $bx_region_begin(eip)
  ;;     $decode_block(b0)   -> $bx_region_collect(b0)   [before every matcher]
  ;;     $decode_block(b1)   -> $bx_region_collect(b1)
  ;;     ...
  ;;                         -> $bx_region_finish()
  ;;
  ;; Each collect classifies that block's ops into $BX_RG_BASE while they are
  ;; still there and then gets out of the way; the per-block matchers run after
  ;; it exactly as before, so a member keeps whatever one-block descriptor it
  ;; would have had. Nothing is decoded twice and no block is decoded that
  ;; $decode_run was not going to decode anyway, which is why the matcher's own
  ;; decode-time cost is a classify pass and nothing else.
  ;;
  ;; WHAT THE SET LOOKS LIKE. Members are guest-contiguous by construction (the
  ;; chain follows fall-throughs), so the region's guest extent is exactly
  ;; [head, last block's end) with no holes. That is what makes the SMC story
  ;; the EXISTING one rather than a new generation counter: $page_publish marks
  ;; every byte of that extent as covered by the region, so a write anywhere
  ;; inside any member retires the whole region, and the region's own publish
  ;; retires the member entries it subsumes. Entry is through the head only --
  ;; a jump INTO a member lands on a cover mark, misses, and re-decodes that
  ;; block, which symmetrically retires the region. That is the "or decline"
  ;; arm of the entry rule, self-healing rather than checked, and the thrash
  ;; table below is what stops the two from ping-ponging forever.
  ;;
  ;; The rules are docs/region-census-2026-09.md's, one for one:
  ;;   single entry          the head; interior entries retire the region
  ;;   <= 16 blocks          $REGION_MAX_BLOCKS
  ;;   <= 8 exits            $REGION_MAX_EXITS
  ;;   uop budget            derived from the 4096-byte emit slack, below
  ;;   one page              $decode_run's own rule, inherited
  ;;   no call/ret/int/indirect inside   $bx_op_unsafe on every body op; a
  ;;                         terminator that is not a foldable Jcc or an
  ;;                         unconditional jump simply ends the region, so the
  ;;                         edge into such a block becomes an exit
  ;;   every op a micro-op   $tree_uop_classify, or a FALLBACK micro-op
  ;; ======================================================================

  ;; Armed by --block-exec; --no-block-exec-regions turns just this half off so
  ;; an A/B can separate the matcher from the one-block executor it rides on.
  ;; Not a flag but a CAP: the largest region the matcher may install, 0 for
  ;; "no multi-block regions at all". A boolean cannot bisect a divergence --
  ;; "regions are wrong" and "regions of more than three blocks are wrong" are
  ;; different bugs and the second is the one that happens -- so the knob that
  ;; turns the family off is the same knob that narrows it. 16 is
  ;; $REGION_MAX_BLOCKS, written as a literal because a global initializer
  ;; cannot read another global.
  (global $bx_region_enabled (mut i32) (i32.const 16))

  (global $BX_RG_BASE i32 (region.addr $BX_RG_BASE 0))
  (global $BX_RG_BASE_SIZE i32 (region.size $BX_RG_BASE))
  ;; A builder record is the 13-word $REGION_BLOCK_WORDS record the descriptor
  ;; wants, verbatim in its first 13 words, followed by the five fields only the
  ;; builder needs. Keeping the prefix identical means emitting a block is a
  ;; 13-word copy with two fixups rather than a field-by-field transcription.
  (global $BX_RG_REC_WORDS i32 (i32.const 24))
  (global $BX_RG_UOP_OFF   i32 (i32.const 512))
  (global $BX_RG_UOPS_MAX  i32 (i32.const 160))
  (global $BX_RG_FB_OFF    i32 (i32.const 1536))
  (global $BX_RG_FB_MAX    i32 (i32.const 1600))
  (global $BX_RG_EXIT_OFF  i32 (i32.const 3140))   ;; 8 exits * 2 words
  (global $BX_RG_THRASH_OFF i32 (i32.const 3200))  ;; 64 slots * 2 words
  (global $BX_RG_HIST_OFF  i32 (i32.const 3400))   ;; 17 counters, by block count
  ;; Coverage by region size, written by the EXECUTOR rather than the matcher:
  ;; how many micro-ops retired inside a descriptor of N blocks, and how many
  ;; times such a descriptor was entered. The install histogram above counts
  ;; static shapes; these two count the work, which is the number the census
  ;; cross-check is against.
  (global $BX_RG_OPSN_OFF  i32 (i32.const 3440))   ;; 17 i64 counters
  (global $BX_RG_ENTN_OFF  i32 (i32.const 3480))   ;; 17 i32 counters
  (global $BX_RG_WHY_OFF   i32 (i32.const 3520))   ;; 8 decline-reason counters
  (global $BX_RG_CFAIL_OFF i32 (i32.const 3536))   ;; 8 collect-refusal counters
  (global $BX_RG_NOFIT_OFF i32 (i32.const 3552))   ;; 9 classify-refusal counters

  ;; Collector state. Live only between $bx_region_begin and $bx_region_finish,
  ;; which are both inside one $decode_run and therefore cannot nest.
  (global $bx_rg_active (mut i32) (i32.const 0))
  (global $bx_rg_n      (mut i32) (i32.const 0))
  (global $bx_rg_uops   (mut i32) (i32.const 0))
  (global $bx_rg_fw     (mut i32) (i32.const 0))
  (global $bx_rg_head   (mut i32) (i32.const 0))
  ;; The EIP $decode_run was asked for, which is what its return value has to
  ;; be the code for. A restarted chain has a head PAST that, and a region
  ;; built there must not be handed back as the run's entry point -- it is
  ;; reached through the page index like any other block.
  (global $bx_rg_run_start (mut i32) (i32.const 0))
  (global $bx_rg_next   (mut i32) (i32.const 0))

  ;; Meters.
  (global $bx_region_installs (mut i32) (i32.const 0))
  (global $bx_region_declines (mut i32) (i32.const 0))
  (global $bx_region_blocks   (mut i32) (i32.const 0))
  ;; Why the last candidate with >= 2 collected blocks was refused:
  ;; 1 cost model / floor, 2 too many exits, 3 past the emit slack,
  ;; 4 thrash guard, 5 publish failed.
  (global $bx_region_why      (mut i32) (i32.const 0))
  (global $bx_region_thrash   (mut i32) (i32.const 0))
  (global $bx_region_restarts (mut i32) (i32.const 0))

  ;; The producer walk's six results, module-level so the walk can be its own
  ;; function instead of six more locals threaded through the classifier.
  (global $bx_pr_kind (mut i32) (i32.const 0))
  (global $bx_pr_a    (mut i32) (i32.const 0))
  (global $bx_pr_b    (mut i32) (i32.const 0))
  (global $bx_pr_imm  (mut i32) (i32.const 0))
  (global $bx_pr_uop  (mut i32) (i32.const 0))
  (global $bx_pr_pos  (mut i32) (i32.const 0))

  (func $bx_rg_rec (param $k i32) (result i32)
    (i32.add (global.get $BX_RG_BASE)
      (i32.mul (local.get $k)
        (i32.shl (global.get $BX_RG_REC_WORDS) (i32.const 2)))))
  (func $bx_rg_word (param $w i32) (result i32)
    (i32.add (global.get $BX_RG_BASE) (i32.shl (local.get $w) (i32.const 2))))
  (func $bx_rg_uop_at (param $j i32) (result i32)
    (call $bx_rg_word
      (i32.add (global.get $BX_RG_UOP_OFF)
               (i32.mul (local.get $j) (global.get $TREE_UOP_WORDS)))))

  ;; ----------------------------------------------------------------------
  ;; The terminator's flag producer. Identical in rule to the backward scan in
  ;; $loop_try_tree_fold -- same accepted handlers, same flag-transparency test
  ;; for the ops it walks over -- but it does not require the branch to close a
  ;; self-loop, because in a region the branch target is resolved against the
  ;; member set instead. Its answers go into the six $bx_pr_* globals.
  ;;
  ;; Returns the uop count on success (n - 2, both terminator ops lifted out)
  ;; and -1 on failure, so zero stays a legal answer for a block that is
  ;; nothing but `cmp / jcc`.
  ;; ----------------------------------------------------------------------
  (func $bx_rg_producer (param $n i32) (result i32)
    (local $t i32) (local $p i32) (local $fn i32) (local $op i32)
    (if (i32.lt_u (local.get $n) (i32.const 2)) (then (return (i32.const -1))))
    (local.set $t (i32.sub (local.get $n) (i32.const 2)))
    (block $found
      (loop $scan
        (local.set $p (call $loop_op_at (local.get $t)))
        (local.set $fn (i32.load (local.get $p)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 64)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 65)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 19)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 10)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 72)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 73)))
        (br_if $found (i32.eq (local.get $fn) (i32.const 128)))
        ;; Not a producer: it may still be walked over, but only if it is a
        ;; micro-op that neither writes nor reads a flag field. Those keep
        ;; their original position and run after the terminator, which is what
        ;; $term_pos records.
        (if (i32.eqz (call $tree_uop_classify (local.get $p)))
          (then (return (i32.const -1))))
        (if (i32.or
              (call $tree_uop_flag_writes (global.get $tu_kind) (global.get $tu_b))
              (call $tree_uop_flag_reads  (global.get $tu_kind) (global.get $tu_b)))
          (then (return (i32.const -1))))
        (if (i32.eqz (local.get $t)) (then (return (i32.const -1))))
        (local.set $t (i32.sub (local.get $t) (i32.const 1)))
        (br $scan)))
    (local.set $op (i32.load offset=4 (local.get $p)))
    (global.set $bx_pr_pos (local.get $t))
    (global.set $bx_pr_imm (i32.const 0))
    (global.set $bx_pr_uop (i32.const 0))
    (if (i32.or (i32.eq (local.get $fn) (i32.const 64))
                (i32.eq (local.get $fn) (i32.const 65)))
      (then
        (global.set $bx_pr_kind (i32.const 0))
        (global.set $bx_pr_uop (i32.eq (local.get $fn) (i32.const 64)))
        (global.set $bx_pr_a (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $bx_pr_b (i32.const 0)))
      (else (if (i32.eq (local.get $fn) (i32.const 19))
        (then
          (global.set $bx_pr_kind (i32.const 1))
          (global.set $bx_pr_a
            (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
          (global.set $bx_pr_b (i32.and (local.get $op) (i32.const 0xF))))
        (else (if (i32.eq (local.get $fn) (i32.const 10))
          (then
            (global.set $bx_pr_kind (i32.const 2))
            (global.set $bx_pr_a (i32.and (local.get $op) (i32.const 0xF)))
            (global.set $bx_pr_b (i32.load offset=8 (local.get $p))))
          (else (if (i32.eq (local.get $fn) (i32.const 72))
            (then
              (global.set $bx_pr_kind (i32.const 6))
              (global.set $bx_pr_a
                (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
              (global.set $bx_pr_b (i32.and (local.get $op) (i32.const 0xF))))
            (else (if (i32.eq (local.get $fn) (i32.const 73))
              (then
                (global.set $bx_pr_kind (i32.const 7))
                (global.set $bx_pr_a (i32.and (local.get $op) (i32.const 0xF)))
                (global.set $bx_pr_b (i32.load offset=8 (local.get $p))))
              (else (if (i32.and (i32.eq (local.get $fn) (i32.const 128))
                                 (i32.eq (i32.and (i32.shr_u (local.get $op) (i32.const 8))
                                                  (i32.const 0xF))
                                         (i32.const 7)))
                (then
                  (global.set $bx_pr_kind (i32.const 3))
                  (global.set $bx_pr_a
                    (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
                  (global.set $bx_pr_b (i32.and (local.get $op) (i32.const 0xF)))
                  (global.set $bx_pr_imm (i32.load offset=8 (local.get $p))))
                (else (return (i32.const -1))))))))))))))
    (i32.sub (local.get $n) (i32.const 2)))

  ;; ----------------------------------------------------------------------
  ;; Classify one just-decoded block into the region builder. Reads OP_INDEX
  ;; and $d_pc, which are only valid right now -- this runs before every other
  ;; matcher for exactly that reason.
  ;; ----------------------------------------------------------------------
  (func $bx_rg_classify_block (param $start_eip i32) (result i32)
    (local $n i32) (local $p i32) (local $pn i32) (local $fn i32) (local $op i32)
    (local $rec i32) (local $i i32) (local $j i32) (local $oi i32) (local $nw i32)
    (local $tidx i32) (local $nuops i32) (local $shape i32)
    (local $term_kind i32) (local $term_a i32) (local $term_b i32)
    (local $term_cc i32) (local $term_uop i32) (local $term_imm i32)
    (local $fall i32) (local $taken i32) (local $extra i32)
    (local $nat i32) (local $nfb i32) (local $up i32) (local $u0 i32)
    (local $k i32) (local $fbp i32)

    (local.set $n (global.get $op_index_n))
    (if (i32.eqz (local.get $n)) (then (return (call $bx_rg_nofit (i32.const 1)))))
    (local.set $u0 (global.get $bx_rg_uops))

    ;; ---- the terminator ------------------------------------------------
    (local.set $p (call $loop_op_at (i32.sub (local.get $n) (i32.const 1))))
    (local.set $fn (i32.load (local.get $p)))
    (local.set $op (i32.load offset=4 (local.get $p)))
    (local.set $tidx (i32.const -1))
    ;; H404 is `test r,r + Jcc` already fused by the decoder: both the flag
    ;; producer and the branch in one op, so there is no backward walk.
    (if (i32.eq (local.get $fn) (i32.const 404))
      (then
        ;; the byte form leaves $flag_sign_shift at 7; term_kind 6 is 32-bit
        (if (i32.and (local.get $op) (i32.const 0x1000))
          (then (return (call $bx_rg_nofit (i32.const 2)))))
        (local.set $shape (i32.const 1))
        (local.set $term_kind (i32.const 6))
        (local.set $term_cc
          (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xF)))
        (local.set $term_a
          (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (local.set $term_b (i32.and (local.get $op) (i32.const 0xF)))
        (local.set $fall  (i32.load offset=8  (local.get $p)))
        (local.set $taken (i32.load offset=12 (local.get $p)))
        (local.set $nuops (i32.sub (local.get $n) (i32.const 1)))
        (local.set $tidx  (i32.sub (local.get $n) (i32.const 1)))))
    (if (i32.and (i32.eqz (local.get $shape))
                 (i32.and (i32.ge_u (local.get $fn) (i32.const 307))
                          (i32.le_u (local.get $fn) (i32.const 322))))
      (then
        (local.set $nuops (call $bx_rg_producer (local.get $n)))
        (if (i32.lt_s (local.get $nuops) (i32.const 0))
          (then (return (call $bx_rg_nofit (i32.const 3)))))
        (local.set $shape (i32.const 1))
        (local.set $term_kind (global.get $bx_pr_kind))
        (local.set $term_a    (global.get $bx_pr_a))
        (local.set $term_b    (global.get $bx_pr_b))
        (local.set $term_imm  (global.get $bx_pr_imm))
        (local.set $term_uop  (global.get $bx_pr_uop))
        (local.set $tidx      (global.get $bx_pr_pos))
        (local.set $term_cc (i32.sub (local.get $fn) (i32.const 307)))
        (local.set $fall  (i32.load offset=8  (local.get $p)))
        (local.set $taken (i32.load offset=12 (local.get $p)))))
    ;; An unconditional edge. H43 is `jmp`, target in the word after the op;
    ;; H45 is $th_block_end, whose operand IS the address -- the decoder emits
    ;; it when a block runs into code it has already compiled. Either way
    ;; term_kind 4 evaluates no condition and always takes succ_fall.
    (if (i32.and (i32.eqz (local.get $shape))
                 (i32.or (i32.eq (local.get $fn) (i32.const 43))
                         (i32.eq (local.get $fn) (i32.const 45))))
      (then
        (local.set $shape (i32.const 1))
        (local.set $term_kind (i32.const 4))
        (local.set $taken
          (select (i32.load offset=8 (local.get $p)) (local.get $op)
                  (i32.eq (local.get $fn) (i32.const 43))))
        (local.set $fall (local.get $taken))
        (local.set $nuops (i32.sub (local.get $n) (i32.const 1)))
        (local.set $tidx (i32.const -1))))
    (if (i32.eqz (local.get $shape)) (then (return (call $bx_rg_nofit (i32.const 4)))))
    (if (i32.gt_u (i32.add (local.get $u0) (local.get $nuops))
                  (global.get $BX_RG_UOPS_MAX))
      (then (return (call $bx_rg_nofit (i32.const 5)))))

    ;; ---- the body ------------------------------------------------------
    (local.set $fbp (call $bx_rg_word (global.get $BX_RG_FB_OFF)))
    (local.set $i (i32.const 0))
    (block $scan_done
      (loop $scan
        (br_if $scan_done (i32.ge_u (local.get $i) (local.get $nuops)))
        ;; uop index -> op index: the flag producer is lifted out of the list
        ;; and everything at or past it shifts by one, exactly as
        ;; $tree_op_for_uop does for the one-block fold. tidx of -1 (an
        ;; unconditional terminator) makes the unsigned compare false for every
        ;; real index, so the mapping is the identity.
        (local.set $oi
          (select (i32.add (local.get $i) (i32.const 1)) (local.get $i)
                  (i32.ge_u (local.get $i) (local.get $tidx))))
        (local.set $p  (call $loop_op_at (local.get $oi)))
        (local.set $pn (call $loop_op_at (i32.add (local.get $oi) (i32.const 1))))
        (local.set $fn (i32.load (local.get $p)))
        (if (call $bx_op_unsafe (local.get $fn)) (then (return (call $bx_rg_nofit (i32.const 6)))))
        (local.set $up (call $bx_rg_uop_at (i32.add (local.get $u0) (local.get $i))))
        (local.set $k (i32.const -1))
        ;; PUSH/POP r32 carry the register in the handler index, so the shared
        ;; classifier has nothing to say about them.
        (if (i32.and (i32.ge_u (local.get $fn) (i32.const 323))
                     (i32.le_u (local.get $fn) (i32.const 330)))
          (then
            (i32.store           (local.get $up) (global.get $TU_PUSH_R))
            (i32.store offset=4  (local.get $up) (i32.sub (local.get $fn) (i32.const 323)))
            (i32.store offset=8  (local.get $up) (i32.const 0))
            (i32.store offset=12 (local.get $up) (i32.const 0))
            (i32.store offset=16 (local.get $up) (local.get $fn))
            (i32.store offset=20 (local.get $up) (i32.const 0))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        (if (i32.and (i32.ge_u (local.get $fn) (i32.const 331))
                     (i32.le_u (local.get $fn) (i32.const 338)))
          (then
            (i32.store           (local.get $up) (global.get $TU_POP_R))
            (i32.store offset=4  (local.get $up) (i32.sub (local.get $fn) (i32.const 331)))
            (i32.store offset=8  (local.get $up) (i32.const 0))
            (i32.store offset=12 (local.get $up) (i32.const 0))
            (i32.store offset=16 (local.get $up) (local.get $fn))
            (i32.store offset=20 (local.get $up) (i32.const 0))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        (if (i32.and (i32.eq (local.get $fn) (i32.const 34))
                     (i32.eq (i32.sub (local.get $pn) (local.get $p)) (i32.const 12)))
          (then
            (i32.store           (local.get $up) (global.get $TU_PUSH_I))
            (i32.store offset=4  (local.get $up) (i32.const 0))
            (i32.store offset=8  (local.get $up) (i32.const 0))
            (i32.store offset=12 (local.get $up) (i32.load offset=8 (local.get $p)))
            (i32.store offset=16 (local.get $up) (local.get $fn))
            (i32.store offset=20 (local.get $up) (i32.const 0))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        (if (call $tree_uop_classify (local.get $p))
          (then (local.set $k (global.get $tu_kind))))
        (if (i32.ge_s (local.get $k) (i32.const 0))
          (then
            (local.set $extra (i32.add (local.get $extra) (global.get $tu_extra)))
            (i32.store           (local.get $up) (local.get $k))
            (i32.store offset=4  (local.get $up) (global.get $tu_d))
            (i32.store offset=8  (local.get $up) (global.get $tu_a))
            (i32.store offset=12 (local.get $up) (global.get $tu_imm))
            (i32.store offset=16 (local.get $up) (global.get $tu_fn))
            (i32.store offset=20 (local.get $up) (global.get $tu_b))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        ;; ---- fallback: the op's own inline words plus the H459 resume
        ;; trampoline go into the trailing pool, and `b` carries the byte
        ;; offset of the first of them.
        (local.set $nw (i32.shr_u
          (i32.sub (i32.sub (local.get $pn) (local.get $p)) (i32.const 8))
          (i32.const 2)))
        (if (i32.gt_u (i32.add (global.get $bx_rg_fw)
                               (i32.add (local.get $nw) (i32.const 2)))
                      (global.get $BX_RG_FB_MAX))
          (then (return (call $bx_rg_nofit (i32.const 7)))))
        (i32.store           (local.get $up) (global.get $TU_FALLBACK))
        (i32.store offset=4  (local.get $up) (i32.const 0))
        (i32.store offset=8  (local.get $up) (local.get $fn))
        (i32.store offset=12 (local.get $up) (i32.load offset=4 (local.get $p)))
        (i32.store offset=16 (local.get $up) (local.get $fn))
        (i32.store offset=20 (local.get $up)
          (i32.shl (global.get $bx_rg_fw) (i32.const 2)))
        (local.set $j (i32.const 0))
        (block $cp_done
          (loop $cp
            (br_if $cp_done (i32.ge_u (local.get $j) (local.get $nw)))
            (i32.store
              (i32.add (local.get $fbp) (i32.shl (global.get $bx_rg_fw) (i32.const 2)))
              (i32.load (i32.add (local.get $p)
                (i32.add (i32.const 8) (i32.shl (local.get $j) (i32.const 2))))))
            (global.set $bx_rg_fw (i32.add (global.get $bx_rg_fw) (i32.const 1)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $cp)))
        (i32.store
          (i32.add (local.get $fbp) (i32.shl (global.get $bx_rg_fw) (i32.const 2)))
          (global.get $BX_RESUME_HANDLER))
        (i32.store offset=4
          (i32.add (local.get $fbp) (i32.shl (global.get $bx_rg_fw) (i32.const 2)))
          (i32.const 0))
        (global.set $bx_rg_fw (i32.add (global.get $bx_rg_fw) (i32.const 2)))
        (local.set $nfb (i32.add (local.get $nfb) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))

    ;; A bare EA compute as the last micro-op has nobody inside the block to
    ;; consume it, and neither a folded terminator nor $eval_cc reads $ea_temp.
    (if (local.get $nuops)
      (then
        (if (i32.eq
              (i32.load (call $bx_rg_uop_at
                (i32.add (local.get $u0) (i32.sub (local.get $nuops) (i32.const 1)))))
              (global.get $TU_EA_SIB))
          (then (return (call $bx_rg_nofit (i32.const 8)))))))

    ;; ---- commit the builder record -------------------------------------
    (local.set $rec (call $bx_rg_rec (global.get $bx_rg_n)))
    (i32.store          (local.get $rec) (local.get $u0))         ;; uop_off
    (i32.store offset=4  (local.get $rec) (local.get $nuops))
    (i32.store offset=8  (local.get $rec) (local.get $tidx))      ;; term_pos
    (i32.store offset=12 (local.get $rec) (local.get $term_kind))
    (i32.store offset=16 (local.get $rec) (local.get $term_a))
    (i32.store offset=20 (local.get $rec) (local.get $term_b))
    (i32.store offset=24 (local.get $rec) (local.get $term_uop))
    (i32.store offset=28 (local.get $rec) (local.get $term_imm))
    (i32.store offset=32 (local.get $rec) (local.get $term_cc))
    ;; cost: one $steps per x86 op the unfolded block billed, plus whatever the
    ;; ops charged on their own account ($tu_extra).
    (i32.store offset=36 (local.get $rec) (i32.add (local.get $n) (local.get $extra)))
    (i32.store offset=40 (local.get $rec) (i32.const 0))          ;; succ_taken, later
    (i32.store offset=44 (local.get $rec) (i32.const 0))          ;; succ_fall, later
    (i32.store offset=48 (local.get $rec) (local.get $start_eip))
    ;; builder-only
    (i32.store offset=52 (local.get $rec) (global.get $d_pc))     ;; guest_end
    (i32.store offset=56 (local.get $rec) (local.get $taken))
    (i32.store offset=60 (local.get $rec) (local.get $fall))
    (i32.store offset=64 (local.get $rec) (local.get $nat))
    (i32.store offset=68 (local.get $rec) (local.get $nfb))
    (global.set $bx_rg_uops (i32.add (local.get $u0) (local.get $nuops)))
    (i32.const 1))

  ;; ----------------------------------------------------------------------
  ;; Collector entry points, called from $decode_run and $decode_block.
  ;; ----------------------------------------------------------------------
  (func $bx_region_begin (param $start_eip i32)
    (global.set $bx_rg_active (i32.const 0))
    (if (i32.eqz (global.get $block_exec_enabled)) (then (return)))
    (if (i32.eqz (global.get $bx_region_enabled)) (then (return)))
    ;; Same three standing-down conditions the one-block matcher has: a 16-bit
    ;; block has a different register and address model, and under
    ;; --fault-null=stop a native memory op can trap with the register locals
    ;; unpublished.
    (if (i32.or (global.get $code16) (global.get $fault_unmapped)) (then (return)))
    (global.set $bx_rg_active (i32.const 1))
    (global.set $bx_rg_n     (i32.const 0))
    (global.set $bx_rg_uops  (i32.const 0))
    (global.set $bx_rg_fw    (i32.const 0))
    (global.set $bx_rg_head  (local.get $start_eip))
    (global.set $bx_rg_run_start (local.get $start_eip))
    (global.set $bx_rg_next  (local.get $start_eip)))

  ;; One classify refusal, recorded by reason, returning the 0 the caller
  ;; wants so a decline site stays one expression. 1 empty block, 2 byte-form
  ;; fused test+Jcc, 3 no flag producer, 4 terminator is not a modelled edge,
  ;; 5 micro-op array full, 6 op the executor may not run natively,
  ;; 7 fallback pool full, 8 trailing EA_SIB.
  (func $bx_rg_nofit (param $r i32) (result i32)
    (local $p i32)
    (local.set $p (call $bx_rg_word
      (i32.add (global.get $BX_RG_NOFIT_OFF) (local.get $r))))
    (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.const 1)))
    (i32.const 0))

  ;; One collect refusal, recorded by reason and by whether the chain already
  ;; had members. A refusal at n>=1 is a region that ended where it should;
  ;; a refusal at n==0 is a head that never started one, and the two want
  ;; opposite fixes, so they are counted apart. Slots 0..3 are the reason at
  ;; n==0, 4..7 the same reason at n>=1.
  (func $bx_rg_cfail (param $r i32)
    (local $p i32)
    (global.set $bx_rg_active (i32.const 0))
    (local.set $p (call $bx_rg_word
      (i32.add (global.get $BX_RG_CFAIL_OFF)
        (i32.add (local.get $r)
          (select (i32.const 4) (i32.const 0)
                  (i32.ne (global.get $bx_rg_n) (i32.const 0)))))))
    (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.const 1))))

  ;; Throw the partial chain away and start a new one at $eip. Every builder
  ;; cursor resets, so whatever a refused classify wrote into the micro-op
  ;; array or the fallback pool is simply overwritten.
  (func $bx_rg_restart (param $eip i32)
    (global.set $bx_rg_active (i32.const 1))
    (global.set $bx_rg_n     (i32.const 0))
    (global.set $bx_rg_uops  (i32.const 0))
    (global.set $bx_rg_fw    (i32.const 0))
    (global.set $bx_rg_head  (local.get $eip))
    (global.set $bx_rg_next  (local.get $eip))
    (global.set $bx_region_restarts
      (i32.add (global.get $bx_region_restarts) (i32.const 1))))

  ;; Called from $decode_block, before $loop_match_block, on every block --
  ;; including the ones decoded outside a run, where $bx_rg_active is 0 and
  ;; this is two loads and a branch.
  (func $bx_region_collect (param $start_eip i32)
    (if (i32.eqz (global.get $bx_rg_active)) (then (return)))
    ;; Guest-contiguity is what makes the region's cover marks a single span.
    ;; $decode_run only ever extends along a fall-through, so this holds by
    ;; construction; it is checked because the failure mode of a hole is a
    ;; write that retires nothing.
    (if (i32.ne (local.get $start_eip) (global.get $bx_rg_next))
      (then
        (if (i32.ge_u (global.get $bx_rg_n) (i32.const 2))
          (then (call $bx_rg_cfail (i32.const 0)) (return)))
        (call $bx_rg_restart (local.get $start_eip))))
    (if (i32.or
          (i32.ge_u (global.get $bx_rg_n) (global.get $REGION_MAX_BLOCKS))
          (i32.ge_u (global.get $bx_rg_n) (global.get $bx_region_enabled)))
      (then (call $bx_rg_cfail (i32.const 1)) (return)))
    (if (i32.or (global.get $op_index_poison) (i32.eqz (global.get $op_index_n)))
      (then
        (if (i32.ge_u (global.get $bx_rg_n) (i32.const 2))
          (then (call $bx_rg_cfail (i32.const 2)) (return)))
        (call $bx_rg_cfail (i32.const 2))
        (call $bx_rg_restart (global.get $d_pc))
        (return)))
    ;; A block this cannot classify simply ENDS the region: the blocks already
    ;; collected stay, and the edge into this one becomes an exit. That is the
    ;; whole reason a call- or ret-terminated block costs nothing here.
    ;;
    ;; ... unless there is nothing to keep. A chain of fewer than two members
    ;; can never install, so ending it here would throw away the REST of the
    ;; run for nothing -- and the run is long: $decode_run walks up to 64
    ;; fall-through blocks, and the first of them is exactly the one most
    ;; likely to end in a `call`, which is not a modelled edge. Measured on
    ;; Quake II before this line existed: 16147 chains died on their own head
    ;; block and 13218 of those were a terminator the descriptor cannot
    ;; express. So restart the builder at the block after the refusal instead
    ;; and let the region form in the middle of the run where the loops are.
    (if (i32.eqz (call $bx_rg_classify_block (local.get $start_eip)))
      (then
        (if (i32.ge_u (global.get $bx_rg_n) (i32.const 2))
          (then (call $bx_rg_cfail (i32.const 3)) (return)))
        (call $bx_rg_cfail (i32.const 3))
        (call $bx_rg_restart (global.get $d_pc))
        (return)))
    (global.set $bx_rg_n (i32.add (global.get $bx_rg_n) (i32.const 1)))
    (global.set $bx_rg_next (global.get $d_pc)))

  ;; Member index whose entry EIP is $ga, or -1.
  (func $bx_rg_member (param $ga i32) (result i32)
    (local $i i32)
    (block $done
      (loop $s
        (br_if $done (i32.ge_u (local.get $i) (global.get $bx_rg_n)))
        (if (i32.eq (i32.load offset=48 (call $bx_rg_rec (local.get $i)))
                    (local.get $ga))
          (then (return (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $s)))
    (i32.const -1))

  ;; Resolve one edge: a member index, or an exit slot encoded as -1-slot.
  ;; $nexits is carried in the scratch word just below the exit table so the
  ;; resolver can allocate slots without a second out-parameter.
  (func $bx_rg_edge (param $ga i32) (result i32)
    (local $m i32) (local $i i32) (local $ne i32) (local $ep i32)
    (local.set $m (call $bx_rg_member (local.get $ga)))
    (if (i32.ge_s (local.get $m) (i32.const 0)) (then (return (local.get $m))))
    (local.set $ep (call $bx_rg_word (global.get $BX_RG_EXIT_OFF)))
    (local.set $ne (i32.load (call $bx_rg_word
                     (i32.sub (global.get $BX_RG_EXIT_OFF) (i32.const 1)))))
    (block $done
      (loop $s
        (br_if $done (i32.ge_u (local.get $i) (local.get $ne)))
        (if (i32.eq (i32.load (i32.add (local.get $ep)
                                (i32.shl (local.get $i) (i32.const 3))))
                    (local.get $ga))
          (then (return (i32.sub (i32.const -1) (local.get $i)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $s)))
    (if (i32.ge_u (local.get $ne) (global.get $REGION_MAX_EXITS))
      (then (return (i32.const 0x7FFFFFFF))))
    (i32.store (i32.add (local.get $ep) (i32.shl (local.get $ne) (i32.const 3)))
               (local.get $ga))
    ;; Every exit publishes all eight. A region has more than one path to most
    ;; of its exits and the union of what those paths define is what a mask
    ;; would have to be; publishing a register the region never wrote is a
    ;; no-op, since the local still holds the value it was loaded with.
    (i32.store offset=4 (i32.add (local.get $ep) (i32.shl (local.get $ne) (i32.const 3)))
               (i32.const 0xFF))
    (i32.store (call $bx_rg_word
                 (i32.sub (global.get $BX_RG_EXIT_OFF) (i32.const 1)))
               (i32.add (local.get $ne) (i32.const 1)))
    (i32.sub (i32.const -1) (local.get $ne)))

  ;; The thrash guard. A member block that something else jumps into gets
  ;; re-decoded, which retires the region; the region's head then misses and
  ;; rebuilds it, which retires the member. Neither step is wrong -- the
  ;; index invariant is preserved both ways -- but the pair can repeat forever
  ;; and would be pure decode cost. 64 direct-mapped slots of (head EIP,
  ;; installs); past 16 the head stops being a region head.
  (func $bx_rg_thrash_ok (param $eip i32) (result i32)
    (local $s i32) (local $c i32)
    (local.set $s (call $bx_rg_word
      (i32.add (global.get $BX_RG_THRASH_OFF)
        (i32.shl (i32.and (i32.shr_u (local.get $eip) (i32.const 4)) (i32.const 63))
                 (i32.const 1)))))
    (if (i32.ne (i32.load (local.get $s)) (local.get $eip))
      (then
        (i32.store (local.get $s) (local.get $eip))
        (i32.store offset=4 (local.get $s) (i32.const 1))
        (return (i32.const 1))))
    (local.set $c (i32.add (i32.load offset=4 (local.get $s)) (i32.const 1)))
    (i32.store offset=4 (local.get $s) (local.get $c))
    (if (i32.gt_u (local.get $c) (i32.const 16))
      (then
        (global.set $bx_region_thrash
          (i32.add (global.get $bx_region_thrash) (i32.const 1)))
        (return (i32.const 0))))
    (i32.const 1))

  ;; One decline, recorded. $bx_region_why keeps the last reason for a quick
  ;; look; the histogram beside it is what answers "what declined most".
  ;; 1 not worth it, 2 exit table full, 3 no room to emit, 4 thrashing,
  ;; 5 publish refused, 6 chain shorter than two blocks, 7 a member declined
  ;; classification so the chain ended early.
  (func $bx_rg_decline (param $w i32)
    (local $p i32)
    (global.set $bx_region_why (local.get $w))
    (global.set $bx_region_declines
      (i32.add (global.get $bx_region_declines) (i32.const 1)))
    (local.set $p (call $bx_rg_word
      (i32.add (global.get $BX_RG_WHY_OFF)
        (select (i32.const 0) (local.get $w) (i32.gt_u (local.get $w) (i32.const 7))))))
    (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.const 1))))

  ;; ----------------------------------------------------------------------
  ;; $bx_region_finish -- decide, then emit the descriptor over a fresh piece
  ;; of the arena and publish it at the head EIP. Takes and returns
  ;; $decode_run's first-block pointer: on an install the region replaces it.
  ;; ----------------------------------------------------------------------
  (func $bx_region_finish (param $t0 i32) (result i32)
    (local $n i32) (local $i i32) (local $j i32) (local $rec i32)
    (local $e i32) (local $ne i32) (local $ep i32)
    (local $nat i32) (local $nfb i32) (local $total i32) (local $bytes i32)
    (local $tstart i32) (local $off i32) (local $head i32) (local $gend i32)
    (local $blocks i32) (local $benefit i32) (local $cost i32)

    (if (i32.eqz (global.get $bx_rg_active)) (then (return (local.get $t0))))
    (global.set $bx_rg_active (i32.const 0))
    (local.set $n (global.get $bx_rg_n))
    (if (i32.lt_u (local.get $n) (i32.const 2))
      (then
        (call $bx_rg_decline (i32.const 6))
        (return (local.get $t0))))
    (local.set $head (global.get $bx_rg_head))
    (if (i32.eqz (call $bx_rg_thrash_ok (local.get $head)))
      (then
        (call $bx_rg_decline (i32.const 4))
        (return (local.get $t0))))

    ;; ---- resolve every edge ---------------------------------------------
    (i32.store (call $bx_rg_word
                 (i32.sub (global.get $BX_RG_EXIT_OFF) (i32.const 1)))
               (i32.const 0))
    (local.set $i (i32.const 0))
    (block $ed_done
      (loop $ed
        (br_if $ed_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $rec (call $bx_rg_rec (local.get $i)))
        (local.set $e (call $bx_rg_edge (i32.load offset=60 (local.get $rec))))
        (if (i32.eq (local.get $e) (i32.const 0x7FFFFFFF))
          (then
            (call $bx_rg_decline (i32.const 2))
            (return (local.get $t0))))
        (i32.store offset=44 (local.get $rec) (local.get $e))
        ;; term_kind 4 evaluates no condition and always takes succ_fall, so
        ;; its taken slot must not claim an exit of its own.
        (if (i32.eq (i32.load offset=12 (local.get $rec)) (i32.const 4))
          (then (i32.store offset=40 (local.get $rec) (local.get $e)))
          (else
            (local.set $e (call $bx_rg_edge (i32.load offset=56 (local.get $rec))))
            (if (i32.eq (local.get $e) (i32.const 0x7FFFFFFF))
              (then
                (call $bx_rg_decline (i32.const 2))
                (return (local.get $t0))))
            (i32.store offset=40 (local.get $rec) (local.get $e))))
        (local.set $nat (i32.add (local.get $nat) (i32.load offset=64 (local.get $rec))))
        (local.set $nfb (i32.add (local.get $nfb) (i32.load offset=68 (local.get $rec))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $ed)))
    (local.set $ne (i32.load (call $bx_rg_word
                     (i32.sub (global.get $BX_RG_EXIT_OFF) (i32.const 1)))))
    (local.set $total (global.get $bx_rg_uops))
    (local.set $gend (i32.load offset=52 (call $bx_rg_rec
                       (i32.sub (local.get $n) (i32.const 1)))))

    ;; ---- worth it? -------------------------------------------------------
    ;; The same ns model the one-block installer uses, with the two terms a
    ;; region actually changes. One ENTRY is paid per execution of the region,
    ;; not per block, so the per-entry benefit is the work on the path taken --
    ;; unknown at decode time. Half the region is the estimate: a two-block
    ;; if/else runs one arm, a loop runs its body many times, and the two
    ;; errors are in opposite directions. The transfer term is exact in the
    ;; other direction -- an N-block region saves at least one edge whenever it
    ;; runs more than one block, and (n-1) when it runs them all.
    (local.set $benefit
      (i32.add
        (i32.div_u (i32.mul (local.get $nat) (global.get $BX_C_UOP)) (i32.const 2))
        (i32.mul (i32.sub (local.get $n) (i32.const 1)) (global.get $BX_C_TRANSFER))))
    (local.set $cost
      (i32.add (global.get $BX_C_ENTRY)
        (i32.mul (local.get $nfb) (global.get $BX_C_FALLBACK))))
    (if (global.get $block_exec_min_uops)
      (then
        (if (i32.lt_u (local.get $total) (global.get $block_exec_min_uops))
          (then
            (call $bx_rg_decline (i32.const 1))
            (return (local.get $t0)))))
      (else
        (if (i32.le_s (local.get $benefit) (local.get $cost))
          (then
            (call $bx_rg_decline (i32.const 1))
            (return (local.get $t0))))))

    ;; ---- the emit slack, derived exactly as the one-block case does -------
    (local.set $bytes
      (i32.add
        (i32.add (i32.const 24)                              ;; dispatch + header
                 (i32.mul (local.get $n) (i32.const 52)))    ;; block table
        (i32.add (i32.shl (local.get $ne) (i32.const 3))     ;; exit table
          (i32.add (i32.mul (local.get $total) (i32.const 24))
                   (i32.shl (global.get $bx_rg_fw) (i32.const 2))))))
    (if (i32.gt_u (local.get $bytes) (i32.const 4096))
      (then
        (call $bx_rg_decline (i32.const 3))
        (return (local.get $t0))))
    ;; $te's overflow backstop must not fire in the middle of this emit.
    (if (i32.or (global.get $thread_flush_pending)
                (i32.ge_u (global.get $thread_alloc)
                  (i32.sub (global.get $THREAD_END) (i32.const 16384))))
      (then
        (call $bx_rg_decline (i32.const 3))
        (return (local.get $t0))))

    ;; ---- emit ------------------------------------------------------------
    (local.set $tstart (global.get $thread_alloc))
    (global.set $op_index_n (i32.const 0))
    (global.set $op_index_poison (i32.const 0))
    (call $te (global.get $BX_HANDLER) (i32.const 0))
    (call $te_raw (local.get $n))
    (call $te_raw (local.get $ne))
    (call $te_raw (local.get $total))
    (call $te_raw (i32.shl (global.get $bx_rg_fw) (i32.const 2)))  ;; fb_bytes
    (local.set $i (i32.const 0))
    (block $bt_done
      (loop $bt
        (br_if $bt_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $rec (call $bx_rg_rec (local.get $i)))
        (local.set $j (i32.const 0))
        (block $w_done
          (loop $w
            (br_if $w_done (i32.ge_u (local.get $j) (global.get $REGION_BLOCK_WORDS)))
            (call $te_raw (i32.load (i32.add (local.get $rec)
                                      (i32.shl (local.get $j) (i32.const 2)))))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $w)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $bt)))
    (local.set $ep (call $bx_rg_word (global.get $BX_RG_EXIT_OFF)))
    (local.set $i (i32.const 0))
    (block $ex_done
      (loop $ex
        (br_if $ex_done (i32.ge_u (local.get $i) (local.get $ne)))
        (call $te_raw (i32.load (i32.add (local.get $ep)
                                  (i32.shl (local.get $i) (i32.const 3)))))
        (call $te_raw (i32.load offset=4 (i32.add (local.get $ep)
                                  (i32.shl (local.get $i) (i32.const 3)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $ex)))
    (local.set $i (i32.const 0))
    (block $uo_done
      (loop $uo
        (br_if $uo_done (i32.ge_u (local.get $i)
          (i32.mul (local.get $total) (global.get $TREE_UOP_WORDS))))
        (call $te_raw (i32.load (call $bx_rg_word
          (i32.add (global.get $BX_RG_UOP_OFF) (local.get $i)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $uo)))
    (local.set $i (i32.const 0))
    (block $fb_done
      (loop $fb
        (br_if $fb_done (i32.ge_u (local.get $i) (global.get $bx_rg_fw)))
        (call $te_raw (i32.load (call $bx_rg_word
          (i32.add (global.get $BX_RG_FB_OFF) (local.get $i)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $fb)))

    ;; ---- publish over the head, and over every member it subsumes --------
    ;; The guest extent is [head, last member's end), which is the union of the
    ;; members' own extents because the chain is contiguous. $page_publish
    ;; retires every block inside it before indexing this one, so the members'
    ;; separate entries go away and the region owns every byte -- which is
    ;; exactly what makes a write to a member retire the region.
    (global.set $op_index_n (i32.const 0))
    (local.set $bytes (global.get $thread_alloc))     ;; reused: the emit end
    (local.set $off (call $page_publish (local.get $head) (local.get $tstart)
                      (local.get $bytes) (local.get $gend)))
    (global.set $bx_region_installs
      (i32.add (global.get $bx_region_installs) (i32.const 1)))
    (global.set $bx_region_blocks
      (i32.add (global.get $bx_region_blocks) (local.get $n)))
    (local.set $i (call $bx_rg_word
      (i32.add (global.get $BX_RG_HIST_OFF) (local.get $n))))
    (i32.store (local.get $i) (i32.add (i32.load (local.get $i)) (i32.const 1)))
    (if (i32.lt_s (local.get $off) (i32.const 0))
      (then
        ;; No home in the chunk. The arena copy is still a correct region, and
        ;; $run is about to execute it; it simply will not be found again.
        (global.set $bx_region_why (i32.const 5))
        (if (i32.ne (local.get $head) (global.get $bx_rg_run_start))
          (then (return (local.get $t0))))
        (return (local.get $tstart))))
    ;; Reclaim the staging bytes, but only when publishing left $thread_alloc
    ;; exactly where the emit ended -- $page_publish can itself carve a chunk
    ;; out of the arena, and rewinding over that would hand the next block's
    ;; emit the memory the page is about to run from. Same rule, same reason,
    ;; as $publish_block.
    (if (i32.eq (global.get $thread_alloc) (local.get $bytes))
      (then (global.set $thread_alloc (local.get $tstart))))
    (global.set $bx_region_why (i32.const 0))
    ;; A region whose head is not the EIP the run was entered for is published
    ;; and findable, but the run still has to return the code for the EIP it
    ;; was asked about.
    (if (i32.ne (local.get $head) (global.get $bx_rg_run_start))
      (then (return (local.get $t0))))
    (i32.add (global.get $cur_page_chunk) (local.get $off)))

  ;; ----------------------------------------------------------------------
  ;; $block_exec_try_install -- the matcher. Called from $decode_block AFTER
  ;; $loop_match_block, so every specialised family keeps priority; a block one
  ;; of them claimed set $op_index_n to 0 and is declined here on the first
  ;; test.
  ;;
  ;; What it emits is a ONE-BLOCK REGION with term_kind 5: the same descriptor
  ;; format the loop matcher emits for a self-loop, with no exit table and the
  ;; block's own terminator left threaded in the stream behind it. Folding that
  ;; terminator (OPEN-1) is a decode-time change to this function alone -- the
  ;; executor already runs folded terminators for every other kind.
  ;; ----------------------------------------------------------------------
  (func $block_exec_try_install (param $start_eip i32) (param $tstart i32) (result i32)
    (local $n i32) (local $i i32) (local $p i32) (local $pn i32) (local $fn i32)
    (local $tail_p i32) (local $tail_bytes i32) (local $tail_words i32)
    (local $sc i32) (local $base i32) (local $cap i32)
    (local $ucap i32) (local $fbb i32) (local $fbw i32)
    (local $words i32) (local $nuops i32) (local $k i32) (local $nw i32)
    (local $j i32) (local $total i32) (local $extra i32)
    (local $nat i32) (local $nfb i32) (local $up i32)

    (if (i32.eqz (global.get $block_exec_enabled)) (then (return (i32.const 0))))
    ;; A fold already rewrote this block.
    (if (i32.eqz (global.get $op_index_n)) (then (return (i32.const 0))))
    ;; OP_INDEX overflowed, so op boundaries are unknown; 16-bit blocks have a
    ;; different register and address model; and under --fault-null=stop a
    ;; native memory op can trap with the register locals unpublished, so the
    ;; whole family stands down while that is armed (design doc section 6).
    (if (i32.or (global.get $op_index_poison)
        (i32.or (global.get $code16) (global.get $fault_unmapped)))
      (then (global.set $block_exec_decl_why (i32.const 2))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))

    (local.set $n (global.get $op_index_n))
    (local.set $base (call $bx_scratch))
    (local.set $cap (call $bx_scratch_words))
    (local.set $ucap (i32.shr_u (local.get $cap) (i32.const 1)))
    (local.set $fbb (i32.add (local.get $base) (i32.shl (local.get $ucap) (i32.const 2))))
    ;; The near half of OP_INDEX holds this block's op addresses. Past its
    ;; halfway point those entries ARE the scratch, so building a descriptor
    ;; would eat the input.
    (if (i32.ge_u (local.get $n) (local.get $ucap))
      (then (global.set $block_exec_decl_why (i32.const 5))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))
    ;; body ops = n - 1 (the terminator is not ours)
    (if (i32.lt_u (local.get $n) (i32.const 2))
      (then (global.set $block_exec_decl_why (i32.const 1))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))

    ;; The terminator: the last op, which must actually be one.
    (local.set $tail_p (call $loop_op_at (i32.sub (local.get $n) (i32.const 1))))
    (local.set $tail_bytes (i32.sub (global.get $thread_alloc) (local.get $tail_p)))
    (if (i32.or (i32.lt_u (local.get $tail_bytes) (i32.const 8))
                (i32.gt_u (local.get $tail_bytes) (i32.const 64)))
      (then (global.set $block_exec_decl_why (i32.const 3))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))
    (if (i32.eqz (call $bx_op_unsafe (i32.load (local.get $tail_p))))
      (then (global.set $block_exec_decl_why (i32.const 3))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))
    (local.set $tail_words (i32.shr_u (local.get $tail_bytes) (i32.const 2)))

    ;; ---- classify and assemble, one pass, into the scratch ----
    (local.set $sc (i32.const 0))
    (local.set $fbw (i32.const 0))
    (local.set $nuops (i32.const 0))
    (local.set $i (i32.const 0))
    (block $scan_done
      (loop $scan
        (br_if $scan_done (i32.ge_u (local.get $i)
                                    (i32.sub (local.get $n) (i32.const 1))))
        (local.set $p (call $loop_op_at (local.get $i)))
        (local.set $pn (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
        (local.set $fn (i32.load (local.get $p)))
        ;; A terminator in the body means the block does not have the shape
        ;; OP_INDEX says it has. Decline rather than guess.
        (if (call $bx_op_unsafe (local.get $fn))
          (then (global.set $block_exec_decl_why (i32.const 3))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0))))
        ;; room for one micro-op, before anything is written
        (if (i32.gt_u (i32.add (local.get $sc) (global.get $TREE_UOP_WORDS))
                      (local.get $ucap))
          (then (global.set $block_exec_decl_why (i32.const 5))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0))))
        (local.set $up (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2))))

        (local.set $k (i32.const -1))
        ;; PUSH/POP r32 carry the register in the HANDLER index (323..338), so
        ;; $tree_uop_classify has nothing to say about them and this file's own
        ;; three kinds are recognised here.
        (if (i32.and (i32.ge_u (local.get $fn) (i32.const 323))
                     (i32.le_u (local.get $fn) (i32.const 330)))
          (then
            (i32.store           (local.get $up) (global.get $TU_PUSH_R))
            (i32.store offset=4  (local.get $up) (i32.sub (local.get $fn) (i32.const 323)))
            (i32.store offset=8  (local.get $up) (i32.const 0))
            (i32.store offset=12 (local.get $up) (i32.const 0))
            (i32.store offset=16 (local.get $up) (local.get $fn))
            (i32.store offset=20 (local.get $up) (i32.const 0))
            (local.set $sc (i32.add (local.get $sc) (global.get $TREE_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        (if (i32.and (i32.ge_u (local.get $fn) (i32.const 331))
                     (i32.le_u (local.get $fn) (i32.const 338)))
          (then
            (i32.store           (local.get $up) (global.get $TU_POP_R))
            (i32.store offset=4  (local.get $up) (i32.sub (local.get $fn) (i32.const 331)))
            (i32.store offset=8  (local.get $up) (i32.const 0))
            (i32.store offset=12 (local.get $up) (i32.const 0))
            (i32.store offset=16 (local.get $up) (local.get $fn))
            (i32.store offset=20 (local.get $up) (i32.const 0))
            (local.set $sc (i32.add (local.get $sc) (global.get $TREE_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        ;; PUSH imm32 -- one inline word, no register at all.
        (if (i32.and (i32.eq (local.get $fn) (i32.const 34))
                     (i32.eq (i32.sub (local.get $pn) (local.get $p)) (i32.const 12)))
          (then
            (i32.store           (local.get $up) (global.get $TU_PUSH_I))
            (i32.store offset=4  (local.get $up) (i32.const 0))
            (i32.store offset=8  (local.get $up) (i32.const 0))
            (i32.store offset=12 (local.get $up) (i32.load offset=8 (local.get $p)))
            (i32.store offset=16 (local.get $up) (local.get $fn))
            (i32.store offset=20 (local.get $up) (i32.const 0))
            (local.set $sc (i32.add (local.get $sc) (global.get $TREE_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))

        ;; The loop matcher's classifier, unchanged, straight into the same kind
        ;; space the executor dispatches on. There is no remap step any more --
        ;; that function was where the two encodings could disagree.
        (if (call $tree_uop_classify (local.get $p))
          (then (local.set $k (global.get $tu_kind))))

        (if (i32.ge_s (local.get $k) (i32.const 0))
          (then
            ;; Steps this op bills BEYOND the one $next charges for its own
            ;; dispatch. Carrying it matters even though nothing architectural
            ;; depends on it: `--block-exec` must not silently buy the guest
            ;; more work per batch than the threaded arm got, or every
            ;; fixed-batch A/B is comparing two different amounts of guest
            ;; execution and reads as a speedup.
            (local.set $extra (i32.add (local.get $extra) (global.get $tu_extra)))
            (i32.store           (local.get $up) (local.get $k))
            (i32.store offset=4  (local.get $up) (global.get $tu_d))
            (i32.store offset=8  (local.get $up) (global.get $tu_a))
            (i32.store offset=12 (local.get $up) (global.get $tu_imm))
            (i32.store offset=16 (local.get $up) (global.get $tu_fn))
            (i32.store offset=20 (local.get $up) (global.get $tu_b))
            (local.set $sc (i32.add (local.get $sc) (global.get $TREE_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $nat (i32.add (local.get $nat) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))

        ;; ---- fallback. The micro-op stays exactly six words; the op's own
        ;; inline words and the H459 resume trampoline go into the pool, and the
        ;; micro-op's `b` word carries the byte offset of the first of them.
        (local.set $nw (i32.shr_u
          (i32.sub (i32.sub (local.get $pn) (local.get $p)) (i32.const 8))
          (i32.const 2)))
        (if (i32.gt_u (i32.add (local.get $fbw) (i32.add (local.get $nw) (i32.const 2)))
                      (i32.sub (local.get $cap) (local.get $ucap)))
          (then (global.set $block_exec_decl_why (i32.const 5))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0))))
        (i32.store           (local.get $up) (global.get $TU_FALLBACK))
        (i32.store offset=4  (local.get $up) (i32.const 0))
        ;; `a` is the handler index -- the executor calls through it, and it is
        ;; never a register number, so the R[a] read the common path does above
        ;; lands on the br_table default and is discarded.
        (i32.store offset=8  (local.get $up) (local.get $fn))
        ;; the handler's own operand word rides in `imm`
        (i32.store offset=12 (local.get $up) (i32.load offset=4 (local.get $p)))
        (i32.store offset=16 (local.get $up) (local.get $fn))
        (i32.store offset=20 (local.get $up) (i32.shl (local.get $fbw) (i32.const 2)))
        (local.set $sc (i32.add (local.get $sc) (global.get $TREE_UOP_WORDS)))
        (local.set $j (i32.const 0))
        (block $cp_done
          (loop $cp
            (br_if $cp_done (i32.ge_u (local.get $j) (local.get $nw)))
            (i32.store (i32.add (local.get $fbb) (i32.shl (local.get $fbw) (i32.const 2)))
              (i32.load (i32.add (local.get $p)
                (i32.add (i32.const 8) (i32.shl (local.get $j) (i32.const 2))))))
            (local.set $fbw (i32.add (local.get $fbw) (i32.const 1)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $cp)))
        (i32.store (i32.add (local.get $fbb) (i32.shl (local.get $fbw) (i32.const 2)))
                   (global.get $BX_RESUME_HANDLER))
        (i32.store offset=4 (i32.add (local.get $fbb) (i32.shl (local.get $fbw) (i32.const 2)))
                   (i32.const 0))
        (local.set $fbw (i32.add (local.get $fbw) (i32.const 2)))
        (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
        (local.set $nfb (i32.add (local.get $nfb) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))

    (local.set $words (local.get $sc))

    ;; ---- worth it? Either the explicit floor, when one was asked for, or the
    ;; cost model. $block_exec_min_uops of 0 means "use the model"; a nonzero
    ;; value is the old uop-count floor, kept because every A/B command in the
    ;; design doc names one and they have to keep meaning what they meant.
    (if (global.get $block_exec_min_uops)
      (then
        (if (i32.lt_u (local.get $nuops) (global.get $block_exec_min_uops))
          (then (global.set $block_exec_decl_why (i32.const 1))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0)))))
      (else
        ;; One block, so no interior transfer is saved yet -- the transfer term
        ;; is written out because the region matcher is what will make it
        ;; nonzero and the arithmetic has to already be right when it does.
        (if (i32.le_s
              (i32.sub
                (i32.add (i32.mul (local.get $nat) (global.get $BX_C_UOP))
                         (i32.mul (i32.const 0) (global.get $BX_C_TRANSFER)))
                (i32.add (global.get $BX_C_ENTRY)
                         (i32.mul (local.get $nfb) (global.get $BX_C_FALLBACK))))
              (i32.const 0))
          (then (global.set $block_exec_decl_why (i32.const 1))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0))))))
    (if (i32.and (i32.ne (global.get $block_exec_max_uops) (i32.const 0))
                 (i32.gt_u (local.get $nuops) (global.get $block_exec_max_uops)))
      (then (global.set $block_exec_decl_why (i32.const 1))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))

    ;; ---- the emit slack, DERIVED. $decode_block reserves 4096 bytes past
    ;; $thread_alloc before $te signals a flush, and a descriptor past it
    ;; corrupts the next block silently instead of failing.
    ;; 8 dispatch + 16 header + 52 block record + 0 exit table + uops + pool
    ;; + the threaded terminator.
    (local.set $total
      (i32.add
        (i32.add (i32.const 76) (i32.shl (local.get $words) (i32.const 2)))
        (i32.add (i32.shl (local.get $fbw) (i32.const 2)) (local.get $tail_bytes))))
    (if (i32.gt_u (local.get $total) (i32.const 4096))
      (then (global.set $block_exec_decl_why (i32.const 4))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))

    ;; Copy the terminator into the scratch before the descriptor overwrites
    ;; the arena it currently lives in. It goes after the fallback pool, which
    ;; is exactly where it will land in the emitted descriptor.
    (local.set $j (i32.const 0))
    (block $tl_done
      (loop $tl
        (br_if $tl_done (i32.ge_u (local.get $j) (local.get $tail_words)))
        (i32.store (i32.add (local.get $fbb)
                     (i32.shl (i32.add (local.get $fbw) (local.get $j)) (i32.const 2)))
          (i32.load (i32.add (local.get $tail_p) (i32.shl (local.get $j) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $tl)))

    ;; ---- emit: a one-block region, no exits, terminator threaded ----
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $BX_HANDLER) (i32.const 0))
    (call $te_raw (i32.const 1))                    ;; nblocks
    (call $te_raw (i32.const 0))                    ;; nexits
    (call $te_raw (local.get $nuops))               ;; uops_total
    (call $te_raw (i32.shl (local.get $fbw) (i32.const 2)))  ;; fb_bytes
    (call $te_raw (i32.const 0))                    ;; uop_off
    (call $te_raw (local.get $nuops))               ;; nuops
    (call $te_raw (i32.const -1))                   ;; term_pos: never
    (call $te_raw (i32.const 5))                    ;; term_kind: threaded tail
    (call $te_raw (i32.const 0))                    ;; term_a
    (call $te_raw (i32.const 0))                    ;; term_b
    (call $te_raw (i32.const 0))                    ;; term_uop
    (call $te_raw (i32.const 0))                    ;; term_imm
    (call $te_raw (i32.const 0))                    ;; term_cc
    ;; cost: the steps this block stands for on its own account. The fallbacks
    ;; are NOT in it -- they charge themselves through the parked counter, and
    ;; counting them here would bill the guest twice.
    (call $te_raw (i32.add (local.get $nat) (local.get $extra)))
    (call $te_raw (i32.const 0))                    ;; succ_taken (unused)
    (call $te_raw (i32.const 0))                    ;; succ_fall  (unused)
    (call $te_raw (local.get $start_eip))           ;; entry_eip
    (local.set $j (i32.const 0))
    (block $em_done
      (loop $em
        (br_if $em_done (i32.ge_u (local.get $j) (local.get $words)))
        (call $te_raw
          (i32.load (i32.add (local.get $base) (i32.shl (local.get $j) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $em)))
    (local.set $j (i32.const 0))
    (block $fb_done
      (loop $fb
        (br_if $fb_done (i32.ge_u (local.get $j) (local.get $fbw)))
        (call $te_raw
          (i32.load (i32.add (local.get $fbb) (i32.shl (local.get $j) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $fb)))
    ;; The terminator goes back through $te, not $te_raw, so OP_INDEX records
    ;; it as the block's last op at its new address -- which is what keeps
    ;; $decode_run's `optr + 16 == d_block_end` adjacency test working and lets
    ;; it patch the fall-through bit into the Jcc operand word.
    (call $te
      (i32.load (i32.add (local.get $fbb) (i32.shl (local.get $fbw) (i32.const 2))))
      (i32.load (i32.add (local.get $fbb)
                  (i32.shl (i32.add (local.get $fbw) (i32.const 1)) (i32.const 2)))))
    (local.set $j (i32.const 2))
    (block $tw_done
      (loop $tw
        (br_if $tw_done (i32.ge_u (local.get $j) (local.get $tail_words)))
        (call $te_raw
          (i32.load (i32.add (local.get $fbb)
                      (i32.shl (i32.add (local.get $fbw) (local.get $j)) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $tw)))

    (global.set $block_exec_installs
      (i32.add (global.get $block_exec_installs) (i32.const 1)))
    (if (global.get $block_exec_trace)
      (then
        (call $host_log_i32 (i32.const 0xBE000000))
        (call $host_log_i32 (local.get $start_eip))
        (call $host_log_i32 (local.get $nuops))
        (local.set $j (i32.const 0))
        (block $tr_done
          (loop $tr
            (br_if $tr_done (i32.ge_u (local.get $j) (local.get $words)))
            ;; kind, then the original handler index this micro-op came from
            (call $host_log_i32
              (i32.load (i32.add (local.get $base) (i32.shl (local.get $j) (i32.const 2)))))
            (call $host_log_i32
              (i32.load offset=16
                (i32.add (local.get $base) (i32.shl (local.get $j) (i32.const 2)))))
            (local.set $j (i32.add (local.get $j) (global.get $TREE_UOP_WORDS)))
            (br $tr)))))
    (i32.const 1))

  ;; ----------------------------------------------------------------------
  ;; H459 -- the fallback resume trampoline. Empty on purpose.
  ;;
  ;; Every $th_* ends in `return_call $next`, so a fallback handler cannot
  ;; simply return to the executor. It tail-calls into $next, which tail-calls
  ;; into THIS -- and because the whole chain is tail calls, this function's
  ;; plain return unwinds straight back to $th_block_exec's frame with $ip
  ;; pointing one word past this op.
  ;; ----------------------------------------------------------------------
  (func $th_bx_resume (param $op i32))


  ;; ----------------------------------------------------------------------
  ;; H458 (and H454, which is an alias of it) -- THE executor.
  ;;
  ;; This function used to be two: $th_tree_fold in 07b-loop-match.wat ran a
  ;; region descriptor over the $TU_* micro-op vocabulary, and $th_block_exec
  ;; here ran a per-block descriptor over a second, DENSE re-encoding of a
  ;; subset of the same vocabulary. Two interpreters over one classifier is a
  ;; place for the two to disagree about what a micro-op means, so they are one
  ;; interpreter now, over one descriptor format:
  ;;
  ;;   a BLOCK is a 1-block region with no back edge (term_kind 5, the
  ;;     terminator left in the thread stream after the descriptor),
  ;;   a SELF-LOOP FOLD is a 1-block region whose taken successor is itself,
  ;;   a REGION is N <= $REGION_MAX_BLOCKS blocks with interior edges.
  ;;
  ;; Everything the two halves could do separately, this does together: the
  ;; per-exit live-out mask and the folded Jcc terminator from H454, and the
  ;; FALLBACK micro-op (run the real handler, spill and reload) plus the stack
  ;; forms from H458. The kind space is $TU_* directly -- there is no second
  ;; numbering to remap through any more.
  ;;
  ;; Eight guest registers in locals for the whole run; memory, flags and the
  ;; branch decision through the ordinary helpers.
  ;; ----------------------------------------------------------------------
  (func $th_block_exec (param $op i32)
    (local $tp i32) (local $up i32) (local $ub i32)
    (local $steps_in i32) (local $fb_used i32) (local $n_fb i32)
    (local $tail_ip i32) (local $fb_bytes i32) (local $fbp i32)
    (local $tail_exit i32)
    (local $nuops i32) (local $live_out i32)
    (local $term_kind i32) (local $term_a i32) (local $term_b i32)
    (local $term_cc i32) (local $term_uop i32) (local $term_imm i32)
    (local $cost i32) (local $term_pos i32)
    (local $r0 i32) (local $r1 i32) (local $r2 i32) (local $r3 i32)
    (local $r4 i32) (local $r5 i32) (local $r6 i32) (local $r7 i32)
    (local $i i32) (local $kind i32) (local $d i32) (local $a i32) (local $imm i32)
    (local $b i32) (local $ea i32) (local $ea_hold i32)
    (local $sh_d i32) (local $sh_a i32) (local $mask i32) (local $ssh i32)
    (local $nof i32) (local $beff i32)
    (local $va i32) (local $vb i32) (local $vr i32)
    (local $old i32) (local $wrote i32)
    (local $nblocks i32) (local $nexits i32) (local $uops_total i32)
    (local $BR i32) (local $EX i32) (local $UO i32) (local $brp i32)
    (local $cur i32) (local $loaded i32) (local $next_b i32)
    (local $succ_t i32) (local $succ_f i32) (local $exit_eip i32) (local $side i32)
    (local $nblk i32) (local $nsteps i32) (local $nuops_run i32) (local $nb_clamped i32)
    (local $steps_avail i32) (local $budget_avail i32)

    (local.set $tp (global.get $ip))
    (local.set $nblocks    (i32.load          (local.get $tp)))
    (local.set $nexits     (i32.load offset=4 (local.get $tp)))
    (local.set $uops_total (i32.load offset=8 (local.get $tp)))
    (local.set $BR (i32.add (local.get $tp) (i32.const 16)))
    (local.set $EX
      (i32.add (local.get $BR)
        (i32.mul (local.get $nblocks)
          (i32.shl (global.get $REGION_BLOCK_WORDS) (i32.const 2)))))
    (local.set $UO
      (i32.add (local.get $EX) (i32.shl (local.get $nexits) (i32.const 3))))
    ;; Header word +12 is `fb_bytes`: the size of the trailing FALLBACK POOL,
    ;; the one variable-length part of the descriptor. A fallback micro-op has
    ;; to hand the real handler its own inline operand words followed by the
    ;; H459 resume op, and those cannot live in the micro-op array without
    ;; breaking its fixed 24-byte stride (which every hand-written descriptor in
    ;; the tests and the bench depends on). So they are relocated here and the
    ;; micro-op's `b` word carries a byte offset into this pool. A descriptor
    ;; with no fallbacks -- every one the loop matcher emits -- writes 0 and the
    ;; pool is empty, which is why the older format is still readable verbatim.
    (local.set $fbp
      (i32.add (local.get $UO)
        (i32.mul (local.get $uops_total)
          (i32.shl (global.get $TREE_UOP_WORDS) (i32.const 2)))))
    (local.set $fb_bytes (i32.load offset=12 (local.get $tp)))
    (local.set $tail_ip (i32.add (local.get $fbp) (local.get $fb_bytes)))
    (global.set $ip (local.get $tail_ip))

    ;; Entry materialization: the whole architectural register file, once.
    ;; Reading all eight unconditionally is cheaper than a live-in mask and
    ;; cannot be wrong about a register the descriptor forgot to name.
    (local.set $r0 (global.get $eax))
    (local.set $r1 (global.get $ecx))
    (local.set $r2 (global.get $edx))
    (local.set $r3 (global.get $ebx))
    (local.set $r4 (global.get $esp))
    (local.set $r5 (global.get $ebp))
    (local.set $r6 (global.get $esi))
    (local.set $r7 (global.get $edi))

    ;; Both meters, exactly as the unfolded graph would have spent them: one
    ;; $steps per guest op ($cost of them per block execution) and one
    ;; $block_budget per block entry. They are checked at a block edge rather
    ;; than bounded up front, because with more than one block in the region
    ;; the per-execution cost is not a constant to divide by. The first block
    ;; always runs -- a do-while runs its body once even with the budget
    ;; already spent, exactly as the block would have when $run entered it.
    (local.set $steps_in (global.get $steps))
    (local.set $steps_avail
      (select (global.get $steps) (i32.const 0)
              (i32.gt_s (global.get $steps) (i32.const 0))))
    ;; A FALLBACK micro-op runs a real handler, and a real handler ends in
    ;; `return_call $next`, which spends a step and will take the out-of-steps
    ;; path if the counter has run down. So the counter is parked high for the
    ;; duration and settled once at exit; what the fallbacks actually spent is
    ;; then `parked - $steps`, measured rather than predicted, so an unfamiliar
    ;; self-charging handler cannot silently change pacing. A descriptor with no
    ;; fallbacks never touches it and the difference is zero.
    (global.set $steps (i32.const 0x100000))
    (local.set $budget_avail
      (select (global.get $block_budget) (i32.const 0)
              (i32.gt_s (global.get $block_budget) (i32.const 0))))

    (global.set $tree_fold_runs
      (i32.add (global.get $tree_fold_runs) (i32.const 1)))

    (local.set $loaded (i32.const -1))
    (block $done
      (loop $trip
        ;; The block record, reloaded only when the block index actually
        ;; changed. A self-loop -- the shape the shipped fold emits -- changes
        ;; it never, so its inner loop pays one compare per iteration and none
        ;; of these thirteen loads.
        (if (i32.ne (local.get $cur) (local.get $loaded))
          (then
            (local.set $brp
              (i32.add (local.get $BR)
                (i32.mul (local.get $cur)
                  (i32.shl (global.get $REGION_BLOCK_WORDS) (i32.const 2)))))
            (local.set $ub
              (i32.add (local.get $UO)
                (i32.mul (i32.load (local.get $brp))
                  (i32.shl (global.get $TREE_UOP_WORDS) (i32.const 2)))))
            (local.set $nuops     (i32.load offset=4  (local.get $brp)))
            (local.set $term_pos  (i32.load offset=8  (local.get $brp)))
            (local.set $term_kind (i32.load offset=12 (local.get $brp)))
            (local.set $term_a    (i32.load offset=16 (local.get $brp)))
            (local.set $term_b    (i32.load offset=20 (local.get $brp)))
            (local.set $term_uop  (i32.load offset=24 (local.get $brp)))
            (local.set $term_imm  (i32.load offset=28 (local.get $brp)))
            (local.set $term_cc   (i32.load offset=32 (local.get $brp)))
            (local.set $cost      (i32.load offset=36 (local.get $brp)))
            (local.set $succ_t    (i32.load offset=40 (local.get $brp)))
            (local.set $succ_f    (i32.load offset=44 (local.get $brp)))
            (local.set $loaded (local.get $cur))))
        (local.set $i (i32.const 0))
        (local.set $up (local.get $ub))
        (block $body_done
          (loop $body
            ;; -- terminator --------------------------------------------------
            ;; It runs at uop index $term_pos, which is usually $nuops (the
            ;; flag producer really was the last thing before the Jcc) but is
            ;; lower whenever the compiler put flag-transparent ops after it --
            ;; see the decode-time walk. Everything from here to $nuops is a
            ;; uop that executes AFTER the counter is updated, exactly as the
            ;; unfolded block ran it, so nothing is reordered across a flag.
            (if (i32.eq (local.get $i) (local.get $term_pos))
              (then
                (local.set $va
                  (block $gt (result i32)
                    (block $t7 (block $t6 (block $t5 (block $t4
                    (block $t3 (block $t2 (block $t1 (block $t0
                      (br_table $t0 $t1 $t2 $t3 $t4 $t5 $t6 $t7 (local.get $term_a)))
                      (br $gt (local.get $r0))) (br $gt (local.get $r1)))
                      (br $gt (local.get $r2))) (br $gt (local.get $r3)))
                      (br $gt (local.get $r4))) (br $gt (local.get $r5)))
                      (br $gt (local.get $r6)))
                    (local.get $r7)))
                (if (i32.eqz (local.get $term_kind))
                  (then
                    ;; dec/inc the counter and write it straight back.
                    (local.set $old (local.get $va))
                    (local.set $vr
                      (select (i32.add (local.get $old) (i32.const 1))
                              (i32.sub (local.get $old) (i32.const 1))
                              (local.get $term_uop)))
                    (if (local.get $term_uop)
                      (then (call $set_flags_inc (local.get $old) (local.get $vr)))
                      (else (call $set_flags_dec (local.get $old) (local.get $vr))))
                    (block $cdone
                    (block $c7 (block $c6 (block $c5 (block $c4
                    (block $c3 (block $c2 (block $c1 (block $c0
                      (br_table $c0 $c1 $c2 $c3 $c4 $c5 $c6 $c7 (local.get $term_a)))
                      (local.set $r0 (local.get $vr)) (br $cdone))
                      (local.set $r1 (local.get $vr)) (br $cdone))
                      (local.set $r2 (local.get $vr)) (br $cdone))
                      (local.set $r3 (local.get $vr)) (br $cdone))
                      (local.set $r4 (local.get $vr)) (br $cdone))
                      (local.set $r5 (local.get $vr)) (br $cdone))
                      (local.set $r6 (local.get $vr)) (br $cdone))
                    (local.set $r7 (local.get $vr))))
                  (else
                    ;; cmp: no register write, all five flag fields.
                    ;; kind 2 compares against the immediate in `term_b`;
                    ;; kinds 1 and 3 both read a register named by it, and
                    ;; kind 3 then dereferences [that register + term_imm].
                    ;; kinds 6 and 7 are `test`, the census's top decline: it
                    ;; is the flag producer for every `test eax,eax / jz` and
                    ;; for the bit-mask tests a state machine branches on, and
                    ;; declining it cost about six points of coverage. It reads
                    ;; its operands exactly like the cmp pair beside it and
                    ;; differs only in the helper it ends in.
                    (local.set $vb (local.get $term_b))
                    (if (i32.or
                          (i32.eq (local.get $term_kind) (i32.const 6))
                          (i32.or (i32.eq (local.get $term_kind) (i32.const 1))
                                  (i32.eq (local.get $term_kind) (i32.const 3))))
                      (then (local.set $vb
                        (block $gu (result i32)
                          (block $u7 (block $u6 (block $u5 (block $u4
                          (block $u3 (block $u2 (block $u1 (block $u0
                            (br_table $u0 $u1 $u2 $u3 $u4 $u5 $u6 $u7 (local.get $term_b)))
                            (br $gu (local.get $r0))) (br $gu (local.get $r1)))
                            (br $gu (local.get $r2))) (br $gu (local.get $r3)))
                            (br $gu (local.get $r4))) (br $gu (local.get $r5)))
                            (br $gu (local.get $r6)))
                          (local.get $r7)))))
                    ;; Re-read every iteration. The bound is in memory and the
                    ;; body may be what moves it; hoisting it would turn a
                    ;; loop that ends into one that does not.
                    (if (i32.eq (local.get $term_kind) (i32.const 3))
                      (then (local.set $vb
                        (call $gl32
                          (i32.add (local.get $vb) (local.get $term_imm))))))
                    (if (i32.ge_u (local.get $term_kind) (i32.const 6))
                      (then
                        (call $set_flags_logic
                          (i32.and (local.get $va) (local.get $vb))))
                      (else
                        (call $set_flags_sub (local.get $va) (local.get $vb)
                          (i32.sub (local.get $va) (local.get $vb)))))))))
            (br_if $body_done (i32.ge_u (local.get $i) (local.get $nuops)))
            (local.set $kind (i32.load           (local.get $up)))
            (local.set $d    (i32.load offset=4  (local.get $up)))
            (local.set $a    (i32.load offset=8  (local.get $up)))
            (local.set $imm  (i32.load offset=12 (local.get $up)))
            (local.set $b    (i32.load offset=20 (local.get $up)))
            ;; Op totals have to stay comparable with a --tree-fold-off build,
            ;; or a handler histogram silently stops counting the work this
            ;; fold does. Re-record the original handler index, as H428 does.
            (if (global.get $handler_hist_enabled)
              (then (call $handler_hist_record (i32.load offset=16 (local.get $up)))))
            (local.set $up (i32.add (local.get $up) (i32.const 24)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))

            ;; R[d] and R[a], by index. A br_table each, but over LOCALS --
            ;; no memory traffic and no call, which is the whole point.
            (local.set $va
              (block $gd (result i32)
                (block $g7 (block $g6 (block $g5 (block $g4
                (block $g3 (block $g2 (block $g1 (block $g0
                  (br_table $g0 $g1 $g2 $g3 $g4 $g5 $g6 $g7 (local.get $d)))
                  (br $gd (local.get $r0))) (br $gd (local.get $r1)))
                  (br $gd (local.get $r2))) (br $gd (local.get $r3)))
                  (br $gd (local.get $r4))) (br $gd (local.get $r5)))
                  (br $gd (local.get $r6)))
                (local.get $r7)))
            (local.set $vb
              (block $ga (result i32)
                (block $a7 (block $a6 (block $a5 (block $a4
                (block $a3 (block $a2 (block $a1 (block $a0
                  (br_table $a0 $a1 $a2 $a3 $a4 $a5 $a6 $a7 (local.get $a)))
                  (br $ga (local.get $r0))) (br $ga (local.get $r1)))
                  (br $ga (local.get $r2))) (br $ga (local.get $r3)))
                  (br $ga (local.get $r4))) (br $ga (local.get $r5)))
                  (br $ga (local.get $r6)))
                (local.get $r7)))

            ;; Sub-register lane and width, decoded unconditionally because it
            ;; is four arithmetic ops with no branch and every alternative
            ;; (a guard, a second br_table) costs more than it saves. The lane
            ;; bits are placed so that one shift extracts each: bit 6 -> 8 and
            ;; bit 7 -> 8, i.e. a byte op on AH..BH reads and writes bits 8..15
            ;; of its container and a low-byte or word op reads bits 0..15.
            (local.set $sh_d (i32.and (i32.shr_u (local.get $b) (i32.const 3)) (i32.const 8)))
            (local.set $sh_a (i32.and (i32.shr_u (local.get $b) (i32.const 4)) (i32.const 8)))
            (local.set $mask
              (select (i32.const 0xFFFF) (i32.const 0xFF)
                      (i32.and (local.get $b) (global.get $TU_B_WORD))))
            (local.set $ssh
              (select (i32.const 15) (i32.const 7)
                      (i32.and (local.get $b) (global.get $TU_B_WORD))))
            ;; "Nobody reads the flags this op would write." Decoded here, next
            ;; to the other `b` fields, so the arms below are a single test on
            ;; a local rather than a mask-and-shift each.
            (local.set $nof (i32.and (local.get $b) (global.get $TU_B_NOFLAGS)))

            ;; The H149 pair's join. A consumer marked TU_B_EA had
            ;; $SIB_SENTINEL where its address should be, so its address is the
            ;; one the preceding TU_EA_SIB left in $ea_hold -- which is exactly
            ;; what $read_addr does with $ea_temp, one indirection shorter.
            ;; Branchless, and folded into the same `b` decode as the lane bits
            ;; above so no kind that cannot carry the bit pays a test for it.
            (local.set $imm
              (select (local.get $ea_hold) (local.get $imm)
                      (i32.and (local.get $b) (global.get $TU_B_EA))))

            ;; SIB effective address, for the contiguous tail of kinds that
            ;; need one. Hoisted here rather than repeated in three arms, and
            ;; guarded by a range test so no other kind pays for it.
            ;;
            ;; $vb already holds R[a] from the read above, so the base term is
            ;; free -- but only when a base is present: `a == 0xF` means the
            ;; SIB had none, and $vb then holds r7 (the br_table's default
            ;; arm), which is why the base is added under a test rather than
            ;; unconditionally. The index needs its own read because it is a
            ;; different register from both $d and $a.
            (if (i32.ge_u (local.get $kind) (global.get $TU_FIRST_SIB))
              (then
                (local.set $ea (local.get $imm))
                (if (i32.ne (local.get $a) (i32.const 0xF))
                  (then (local.set $ea (i32.add (local.get $ea) (local.get $vb)))))
                (if (i32.ne (i32.and (local.get $b) (i32.const 0xF)) (i32.const 0xF))
                  (then (local.set $ea
                    (i32.add (local.get $ea)
                      (i32.shl
                        (block $gi (result i32)
                          (block $i7 (block $i6 (block $i5 (block $i4
                          (block $i3 (block $i2 (block $i1 (block $i0
                            (br_table $i0 $i1 $i2 $i3 $i4 $i5 $i6 $i7
                                      (i32.and (local.get $b) (i32.const 0xF))))
                            (br $gi (local.get $r0))) (br $gi (local.get $r1)))
                            (br $gi (local.get $r2))) (br $gi (local.get $r3)))
                            (br $gi (local.get $r4))) (br $gi (local.get $r5)))
                            (br $gi (local.get $r6)))
                          (local.get $r7))
                        ;; Scale is TWO bits at b[5:4]. The `& 3` is load-bearing
                        ;; on exactly one kind: TU_STORE8_SIB is the only one that
                        ;; carries SIB fields AND a lane bit, and TU_B_LANE_D is
                        ;; 0x40 -- bit 6, which an unmasked `b >> 4` folds into
                        ;; the shift amount as +4. A high-byte store through an
                        ;; indexed address then writes at index<<(scale+4).
                        ;; Found by test/test-block-exec.js, which reaches the
                        ;; combination H454 has apparently never met in a
                        ;; self-loop; H458 shares this decode verbatim.
                        (i32.and (i32.shr_u (local.get $b) (i32.const 4)) (i32.const 3)))))))))

            ;; Evaluate. Every arm publishes exactly the flag fields its
            ;; scalar handler publishes, by calling the same helper -- which
            ;; is what makes the per-field join right at every instant.
            ;;
            ;; $wrote, rather than a second exit label out of the br_table:
            ;; a store is the one kind whose result does not go to a register,
            ;; and branching around the writeback from inside the table put
            ;; the branch target outside the loop body the first time this was
            ;; written -- which silently truncated every iteration at its
            ;; first store instead of failing.
            (local.set $wrote (i32.const 1))
            (block $kdone
              (block $k57 (block $k56 (block $k55 (block $k54
              (block $k53 (block $k52 (block $k51 (block $k50
              (block $k49 (block $k48 (block $k47
              (block $k46 (block $k45 (block $k44 (block $k43
              (block $k42 (block $k41 (block $k40
              (block $k39 (block $k38 (block $k37 (block $k36 (block $k35
              (block $k34 (block $k33 (block $k32 (block $k31 (block $k30
              (block $k29 (block $k28 (block $k27 (block $k26 (block $k25
              (block $k24 (block $k23 (block $k22
              (block $k21 (block $k20 (block $k19 (block $k18
              (block $k17 (block $k16 (block $k15 (block $k14
              (block $k13 (block $k12 (block $k11 (block $k10
              (block $k09 (block $k08 (block $k07 (block $k06
              (block $k05 (block $k04 (block $k03 (block $k02
              (block $k01 (block $k00
                (br_table $k00 $k01 $k02 $k03 $k04 $k05 $k06 $k07 $k08 $k09
                          $k10 $k11 $k12 $k13 $k14 $k15 $k16 $k17 $k18 $k19
                          $k20 $k21 $k22 $k23 $k24 $k25 $k26 $k27 $k28 $k29
                          $k30 $k31 $k32 $k33 $k34 $k35 $k36 $k37 $k38 $k39
                          $k40 $k41 $k42 $k43 $k44 $k45 $k46 $k47 $k48 $k49
                          $k50 $k51 $k52 $k53 $k54 $k55 $k56 $k57
                          $k57
                          (local.get $kind)))
                ;; 0 MOV_RR
                (local.set $vr (local.get $vb)) (br $kdone))
                ;; 1 MOV_RI
                (local.set $vr (local.get $imm)) (br $kdone))
                ;; 2 LEA_RO -- LEA never touches flags
                (local.set $vr (i32.add (local.get $vb) (local.get $imm))) (br $kdone))
                ;; 3 ADD_RR. From here to 19, the arithmetic is unconditional
                ;; and only the $set_flags_* call is gated on $nof -- the bit
                ;; the decode-time dead-flag pass set when it proved nothing
                ;; between here and the terminator reads what this would write.
                (local.set $vr (i32.add (local.get $va) (local.get $vb)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_add (local.get $va) (local.get $vb) (local.get $vr))))
                (br $kdone))
                ;; 4 ADD_RI
                (local.set $vr (i32.add (local.get $va) (local.get $imm)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_add (local.get $va) (local.get $imm) (local.get $vr))))
                (br $kdone))
                ;; 5 SUB_RR
                (local.set $vr (i32.sub (local.get $va) (local.get $vb)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_sub (local.get $va) (local.get $vb) (local.get $vr))))
                (br $kdone))
                ;; 6 SUB_RI
                (local.set $vr (i32.sub (local.get $va) (local.get $imm)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_sub (local.get $va) (local.get $imm) (local.get $vr))))
                (br $kdone))
                ;; 7 AND_RR
                (local.set $vr (i32.and (local.get $va) (local.get $vb)))
                (if (i32.eqz (local.get $nof)) (then (call $set_flags_logic (local.get $vr))))
                (br $kdone))
                ;; 8 AND_RI
                (local.set $vr (i32.and (local.get $va) (local.get $imm)))
                (if (i32.eqz (local.get $nof)) (then (call $set_flags_logic (local.get $vr))))
                (br $kdone))
                ;; 9 OR_RR
                (local.set $vr (i32.or (local.get $va) (local.get $vb)))
                (if (i32.eqz (local.get $nof)) (then (call $set_flags_logic (local.get $vr))))
                (br $kdone))
                ;; 10 OR_RI
                (local.set $vr (i32.or (local.get $va) (local.get $imm)))
                (if (i32.eqz (local.get $nof)) (then (call $set_flags_logic (local.get $vr))))
                (br $kdone))
                ;; 11 XOR_RR
                (local.set $vr (i32.xor (local.get $va) (local.get $vb)))
                (if (i32.eqz (local.get $nof)) (then (call $set_flags_logic (local.get $vr))))
                (br $kdone))
                ;; 12 XOR_RI
                (local.set $vr (i32.xor (local.get $va) (local.get $imm)))
                (if (i32.eqz (local.get $nof)) (then (call $set_flags_logic (local.get $vr))))
                (br $kdone))
                ;; 13 INC -- preserves CF, which $set_flags_inc reads back out
                ;; of whatever really wrote it last. Skipping it when the flags
                ;; are dead also skips that $get_cf, which is the single most
                ;; expensive thing the elision removes.
                (local.set $vr (i32.add (local.get $va) (i32.const 1)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_inc (local.get $va) (local.get $vr))))
                (br $kdone))
                ;; 14 DEC
                (local.set $vr (i32.sub (local.get $va) (i32.const 1)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_dec (local.get $va) (local.get $vr))))
                (br $kdone))
                ;; 15 NEG == SUB 0, src
                (local.set $vr (i32.sub (i32.const 0) (local.get $va)))
                (if (i32.eqz (local.get $nof))
                  (then (call $set_flags_sub (i32.const 0) (local.get $va) (local.get $vr))))
                (br $kdone))
                ;; 16 NOT -- no flags, exactly as x86
                (local.set $vr (i32.xor (local.get $va) (i32.const -1))) (br $kdone))
                ;; 17 SHIFT -- $do_shift32 owns the flag contract, including
                ;; the count==0 case that writes nothing at all.
                (local.set $vr
                  (call $do_shift32 (local.get $a) (local.get $va) (local.get $imm)))
                (br $kdone))
                ;; 18 IMUL_RR. The 64-bit product exists only to decide CF/OF,
                ;; so a dead-flag IMUL drops the widening multiply as well as
                ;; the three global stores.
                (local.set $vr (i32.mul (local.get $va) (local.get $vb)))
                (if (i32.eqz (local.get $nof))
                  (then
                    (global.set $flag_op (i32.const 6))
                    (global.set $flag_sign_shift (i32.const 31))
                    (global.set $flag_b
                      (i64.ne
                        (i64.mul (i64.extend_i32_s (local.get $va))
                                 (i64.extend_i32_s (local.get $vb)))
                        (i64.extend_i32_s (local.get $vr))))
                    (global.set $flag_res (local.get $vr))))
                (br $kdone))
                ;; 19 IMUL_RI
                (local.set $vr (i32.mul (local.get $vb) (local.get $imm)))
                (if (i32.eqz (local.get $nof))
                  (then
                    (global.set $flag_op (i32.const 6))
                    (global.set $flag_sign_shift (i32.const 31))
                    (global.set $flag_b
                      (i64.ne
                        (i64.mul (i64.extend_i32_s (local.get $vb))
                                 (i64.extend_i32_s (local.get $imm)))
                        (i64.extend_i32_s (local.get $vr))))
                    (global.set $flag_res (local.get $vr))))
                (br $kdone))
                ;; 20 LOAD32
                (local.set $vr
                  (call $gl32 (i32.add (local.get $vb) (local.get $imm))))
                (br $kdone))
                ;; 21 STORE32. Writes memory, not a register, so it skips the
                ;; writeback entirely -- and it goes through $gs32, which is
                ;; what keeps SMC invalidation and page crossing identical to
                ;; the scalar path.
                (call $gs32 (i32.add (local.get $vb) (local.get $imm)) (local.get $va))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 22 LOAD32_ABS -- the address is a decode-time constant.
                (local.set $vr (call $gl32 (local.get $imm))) (br $kdone))
                ;; 23 STORE32_ABS
                (call $gs32 (local.get $imm) (local.get $va))
                (local.set $wrote (i32.const 0)) (br $kdone))

                ;; -- sub-register writes. Each of these computes a value at
                ;; the sub-width and then INSERTS it into the container's
                ;; local, leaving the lanes it does not cover exactly as they
                ;; were -- which is what makes a partial write expressible here
                ;; at all, and why $vr is always a full 32-bit value even when
                ;; the op wrote eight bits of it.

                ;; 24 MOV_SUB_RR -- no flags, either width.
                (local.set $vr
                  (i32.or
                    (i32.and (local.get $va)
                      (i32.xor (i32.shl (local.get $mask) (local.get $sh_d)) (i32.const -1)))
                    (i32.shl
                      (i32.and (i32.shr_u (local.get $vb) (local.get $sh_a)) (local.get $mask))
                      (local.get $sh_d))))
                (br $kdone))
                ;; 25 MOV_SUB_RI -- no flags.
                (local.set $vr
                  (i32.or
                    (i32.and (local.get $va)
                      (i32.xor (i32.shl (local.get $mask) (local.get $sh_d)) (i32.const -1)))
                    (i32.shl (i32.and (local.get $imm) (local.get $mask)) (local.get $sh_d))))
                (br $kdone))
                ;; 26 ALU_SUB_RR. $do_alu_sized owns the flag contract at this
                ;; width, including flag_sign_shift; CMP (7) writes no register.
                ;; With the flags dead, $tree_alu_sized_noflags computes the
                ;; same six results with the flag half removed -- and a dead
                ;; CMP becomes nothing at all, since it writes no register
                ;; either.
                (local.set $vb
                  (if (result i32) (local.get $nof)
                    (then (call $tree_alu_sized_noflags
                      (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT)) (i32.const 0xF))
                      (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (local.get $mask))
                      (i32.and (i32.shr_u (local.get $vb) (local.get $sh_a)) (local.get $mask))
                      (local.get $mask)))
                    (else (call $do_alu_sized
                      (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT)) (i32.const 0xF))
                      (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (local.get $mask))
                      (i32.and (i32.shr_u (local.get $vb) (local.get $sh_a)) (local.get $mask))
                      (local.get $mask) (local.get $ssh)))))
                (if (i32.eq (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT))
                                     (i32.const 0xF))
                            (i32.const 7))
                  (then (local.set $wrote (i32.const 0)))
                  (else (local.set $vr
                    (i32.or
                      (i32.and (local.get $va)
                        (i32.xor (i32.shl (local.get $mask) (local.get $sh_d)) (i32.const -1)))
                      (i32.shl (local.get $vb) (local.get $sh_d))))))
                (br $kdone))
                ;; 27 ALU_SUB_RI
                (local.set $vb
                  (if (result i32) (local.get $nof)
                    (then (call $tree_alu_sized_noflags
                      (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT)) (i32.const 0xF))
                      (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (local.get $mask))
                      (i32.and (local.get $imm) (local.get $mask))
                      (local.get $mask)))
                    (else (call $do_alu_sized
                      (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT)) (i32.const 0xF))
                      (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (local.get $mask))
                      (i32.and (local.get $imm) (local.get $mask))
                      (local.get $mask) (local.get $ssh)))))
                (if (i32.eq (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT))
                                     (i32.const 0xF))
                            (i32.const 7))
                  (then (local.set $wrote (i32.const 0)))
                  (else (local.set $vr
                    (i32.or
                      (i32.and (local.get $va)
                        (i32.xor (i32.shl (local.get $mask) (local.get $sh_d)) (i32.const -1)))
                      (i32.shl (local.get $vb) (local.get $sh_d))))))
                (br $kdone))
                ;; 28 LOAD8_RO -- R8[d] = [R[a] + imm]
                (local.set $vr
                  (i32.or
                    (i32.and (local.get $va)
                      (i32.xor (i32.shl (i32.const 0xFF) (local.get $sh_d)) (i32.const -1)))
                    (i32.shl (call $gl8 (i32.add (local.get $vb) (local.get $imm)))
                             (local.get $sh_d))))
                (br $kdone))
                ;; 29 STORE8_RO
                (call $gs8 (i32.add (local.get $vb) (local.get $imm))
                  (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (i32.const 0xFF)))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 30 LOAD8_ABS
                (local.set $vr
                  (i32.or
                    (i32.and (local.get $va)
                      (i32.xor (i32.shl (i32.const 0xFF) (local.get $sh_d)) (i32.const -1)))
                    (i32.shl (call $gl8 (local.get $imm)) (local.get $sh_d))))
                (br $kdone))
                ;; 31 STORE8_ABS
                (call $gs8 (local.get $imm)
                  (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (i32.const 0xFF)))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 32 MOVZX8_RO -- narrow read, WHOLE destination written.
                (local.set $vr (call $gl8 (i32.add (local.get $vb) (local.get $imm))))
                (br $kdone))
                ;; 33 MOVSX8_RO
                (local.set $vr
                  (call $sign_ext8 (call $gl8 (i32.add (local.get $vb) (local.get $imm)))))
                (br $kdone))
                ;; 34 LEA_SIB -- address arithmetic only, no memory and, as on
                ;; x86, no flags.
                (local.set $vr (local.get $ea)) (br $kdone))
                ;; 35 LOAD32_SIB
                (local.set $vr (call $gl32 (local.get $ea))) (br $kdone))
                ;; 36 STORE32_SIB
                (call $gs32 (local.get $ea) (local.get $va))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 37 MOVSX8_SIB
                (local.set $vr (call $sign_ext8 (call $gl8 (local.get $ea)))) (br $kdone))
                ;; 38 STORE8_SIB
                (call $gs8 (local.get $ea)
                  (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (i32.const 0xFF)))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 39 MOV_M8_I_SIB. The immediate rides in `b` because this
                ;; handler's operand word IS the byte.
                (call $gs8 (local.get $ea)
                  (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_IMM8_SHIFT))
                           (i32.const 0xFF)))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 40 LOAD16_ABS -- the low half only; the top half of the
                ;; container survives, exactly as $th_mov_r16_m16 leaves it.
                (local.set $vr
                  (i32.or (i32.and (local.get $va) (i32.const 0xFFFF0000))
                          (call $gl16 (local.get $imm))))
                (br $kdone))
                ;; 41 LOAD16_RO
                (local.set $vr
                  (i32.or (i32.and (local.get $va) (i32.const 0xFFFF0000))
                          (call $gl16 (i32.add (local.get $vb) (local.get $imm)))))
                (br $kdone))
                ;; 42 STORE16_RO
                (call $gs16 (i32.add (local.get $vb) (local.get $imm))
                  (i32.and (local.get $va) (i32.const 0xFFFF)))
                (local.set $wrote (i32.const 0)) (br $kdone))
                ;; 43 ADC_RR -- $th_adc_r_r, transcribed. The CF fix-up is not
                ;; decoration: when `b + cf` wraps, the carry out is 1 no
                ;; matter what the sum says, and flag_op 8 is the raw mode that
                ;; states that without disturbing the ZF/SF the add just set.
                (local.set $beff (i32.add (local.get $vb) (call $get_cf)))
                (local.set $vr (i32.add (local.get $va) (local.get $beff)))
                (call $set_flags_add (local.get $va) (local.get $beff) (local.get $vr))
                (if (i32.lt_u (local.get $beff) (local.get $vb))
                  (then (global.set $flag_op (i32.const 8))
                        (global.set $flag_a (i32.const 1))
                        (global.set $flag_b (i32.const 0))))
                (br $kdone))
                ;; 44 ADC_RI
                (local.set $beff (i32.add (local.get $imm) (call $get_cf)))
                (local.set $vr (i32.add (local.get $va) (local.get $beff)))
                (call $set_flags_add (local.get $va) (local.get $beff) (local.get $vr))
                (if (i32.lt_u (local.get $beff) (local.get $imm))
                  (then (global.set $flag_op (i32.const 8))
                        (global.set $flag_a (i32.const 1))
                        (global.set $flag_b (i32.const 0))))
                (br $kdone))
                ;; 45 SBB_RR -- the borrow twin, which fixes flag_a/flag_b only.
                (local.set $beff (i32.add (local.get $vb) (call $get_cf)))
                (local.set $vr (i32.sub (local.get $va) (local.get $beff)))
                (call $set_flags_sub (local.get $va) (local.get $beff) (local.get $vr))
                (if (i32.lt_u (local.get $beff) (local.get $vb))
                  (then (global.set $flag_a (i32.const 0))
                        (global.set $flag_b (i32.const 1))))
                (br $kdone))
              ;; 46 SBB_RI
              (local.set $beff (i32.add (local.get $imm) (call $get_cf)))
              (local.set $vr (i32.sub (local.get $va) (local.get $beff)))
              (call $set_flags_sub (local.get $va) (local.get $beff) (local.get $vr))
              (if (i32.lt_u (local.get $beff) (local.get $imm))
                (then (global.set $flag_a (i32.const 0))
                      (global.set $flag_b (i32.const 1))))
              (br $kdone))
              ;; 47 EA_SIB -- the address is already in $ea (the hoist above
              ;; computed it, since this kind is in the SIB range). Park it for
              ;; the next micro-op and write no register: this op is not an
              ;; instruction, it is half of one.
              (local.set $ea_hold (local.get $ea))
              (local.set $wrote (i32.const 0))
              (br $kdone))
              ;; 48 EA_SIB_LD8 (and the unreachable default) -- the same EA,
              ;; plus the byte load H149's operand bit 8 fused into it. The
              ;; insert is the ordinary sub-register one, so AH..BH land in
              ;; bits 8..15 of their container exactly as $set_reg8 puts them.
              (local.set $ea_hold (local.get $ea))
              (local.set $vr
                (i32.or
                  (i32.and (local.get $va)
                    (i32.xor (i32.shl (i32.const 0xFF) (local.get $sh_d)) (i32.const -1)))
                  (i32.shl (call $gl8 (local.get $ea)) (local.get $sh_d))))
              (br $kdone))
              ;; 49 REP_STR. Publish, call the
              ;; interpreter's own body, reload. The publish has to be all
              ;; eight and not just ESI/EDI/ECX/EAX: $gs8/$gl8 reach
              ;; $invalidate_code_write and the page compiler, and a fault
              ;; path reads the register file to build its report, so leaving
              ;; a stale global behind would be visible from inside the call.
              (global.set $eax (local.get $r0))
              (global.set $ecx (local.get $r1))
              (global.set $edx (local.get $r2))
              (global.set $ebx (local.get $r3))
              (global.set $esp (local.get $r4))
              (global.set $ebp (local.get $r5))
              (global.set $esi (local.get $r6))
              (global.set $edi (local.get $r7))
              (block $rdone
                (block $r3b (block $r2b (block $r1b (block $r0b
                  (br_table $r0b $r1b $r2b $r3b $r3b (local.get $d)))
                  (call $rep_movsb_do) (br $rdone))
                  (call $rep_movsd_do) (br $rdone))
                  (call $rep_stosb_do) (br $rdone))
                (call $rep_stosd_do))
              (local.set $r0 (global.get $eax))
              (local.set $r1 (global.get $ecx))
              (local.set $r2 (global.get $edx))
              (local.set $r3 (global.get $ebx))
              (local.set $r4 (global.get $esp))
              (local.set $r5 (global.get $ebp))
              (local.set $r6 (global.get $esi))
              (local.set $r7 (global.get $edi))
              (local.set $wrote (i32.const 0))
              (br $kdone))
              ;; 50 X87_MEM -- absolute (or H149-paired) address. The hoisted
              ;; $ea is already the address: `a` is 0xF so no base was added
              ;; and the SIB index nibble is 0xF so no index was, leaving the
              ;; immediate the TU_B_EA select above may have replaced with
              ;; $ea_hold. $fpu_exec_mem is the same function $th_fpu_mem
              ;; calls with the same two nibbles, so the load width, the
              ;; push/pop, the tag word and every sticky bit in $fpu_sw are
              ;; the interpreter's, not this family's.
              (call $fpu_exec_mem
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_GROUP_SHIFT))
                         (i32.const 0xF))
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_REG_SHIFT))
                         (i32.const 0xF))
                (local.get $ea))
              (local.set $wrote (i32.const 0))
              (br $kdone))
              ;; 51 X87_MRO -- base+disp. $ea is R[a] + imm, computed from the
              ;; register LOCAL; the scalar H190 pays a $get_reg for the same
              ;; number. Identical call otherwise.
              (call $fpu_exec_mem
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_GROUP_SHIFT))
                         (i32.const 0xF))
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_REG_SHIFT))
                         (i32.const 0xF))
                (local.get $ea))
              (local.set $wrote (i32.const 0))
              (br $kdone))
              ;; 52 X87_REG -- no memory and no general register at all. The
              ;; accepted set excludes FCMOVcc and FCOMI/FUCOMI, so nothing
              ;; here reads or writes a lazy-flag field and the dead-flag
              ;; pass's model stays complete.
              (call $fpu_exec_reg
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_GROUP_SHIFT))
                         (i32.const 0xF))
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_REG_SHIFT))
                         (i32.const 0xF))
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_X87_RM_SHIFT))
                         (i32.const 0xF)))
              (local.set $wrote (i32.const 0))
              (br $kdone))
              ;; 53 FNSTSW AX (and the unreachable default). The one x87 op
              ;; that writes a general register, so EAX round-trips through
              ;; the global the way TU_REP_STR round-trips all eight -- the
              ;; interpreter's arm reads $eax to preserve its top half and
              ;; writes the status word into the bottom, and reproducing that
              ;; here would be a second copy of it. Only EAX needs publishing:
              ;; DF E0 reads and writes nothing else.
              (global.set $eax (local.get $r0))
              (call $fpu_exec_reg (i32.const 7) (i32.const 4) (i32.const 0))
              (local.set $r0 (global.get $eax))
              (local.set $wrote (i32.const 0))
              (br $kdone))

              ;; 54 PUSH_R. ESP is r4, a local, so the whole push is register
              ;; arithmetic plus one $gs32. `push esp` pushes the OLD esp, which
              ;; is already what $va holds.
              (local.set $r4 (i32.sub (local.get $r4) (i32.const 4)))
              (call $gs32 (local.get $r4) (local.get $va))
              (local.set $wrote (i32.const 0))
              (br $kdone))

              ;; 55 POP_R. The writeback runs after the ESP adjustment, so
              ;; `pop esp` lands the loaded value and not the incremented one --
              ;; which is what the architecture says.
              (local.set $vr (call $gl32 (local.get $r4)))
              (local.set $r4 (i32.add (local.get $r4) (i32.const 4)))
              (br $kdone))

              ;; 56 PUSH_I
              (local.set $r4 (i32.sub (local.get $r4) (i32.const 4)))
              (call $gs32 (local.get $r4) (local.get $imm))
              (local.set $wrote (i32.const 0))
              (br $kdone))

              ;; 57 FALLBACK -- run the op's real handler.
              ;;
              ;; Spill all eight first: $gs*/$gl* reach $invalidate_code_write
              ;; and the page compiler, a fault path reads the register file to
              ;; build its report, and every --trace-* formatter reads the
              ;; globals, so a stale one is observable from inside the call.
              ;; This spill is also the publish-before-trap guarantee -- a
              ;; handler that traps does so with the register file exactly as
              ;; the threaded path would have left it.
              ;;
              ;; `a` carries the handler index (a fallback has no R[a] operand,
              ;; so the field is free), `imm` the handler's own operand word,
              ;; and `b` the byte offset of this op's inline words in the
              ;; trailing fallback pool.
              (global.set $eax (local.get $r0))
              (global.set $ecx (local.get $r1))
              (global.set $edx (local.get $r2))
              (global.set $ebx (local.get $r3))
              (global.set $esp (local.get $r4))
              (global.set $ebp (local.get $r5))
              (global.set $esi (local.get $r6))
              (global.set $edi (local.get $r7))
              ;; The H149 pair's OTHER half. A native TU_EA_SIB parks its
              ;; address in $ea_hold, a LOCAL -- but a consumer that fell back
              ;; reads it through $read_addr, which substitutes the $ea_temp
              ;; GLOBAL for a $SIB_SENTINEL address word. Both directions,
              ;; because a producer can fall back too and the next micro-op may
              ;; be a native consumer reading $ea_hold.
              (global.set $ea_temp (local.get $ea_hold))
              (global.set $ip (i32.add (local.get $fbp) (local.get $b)))
              (call_indirect (type $handler_t)
                (local.get $imm) (local.get $a))
              (local.set $ea_hold (global.get $ea_temp))
              (local.set $r0 (global.get $eax))
              (local.set $r1 (global.get $ecx))
              (local.set $r2 (global.get $edx))
              (local.set $r3 (global.get $ebx))
              (local.set $r4 (global.get $esp))
              (local.set $r5 (global.get $ebp))
              (local.set $r6 (global.get $esi))
              (local.set $r7 (global.get $edi))
              (local.set $n_fb (i32.add (local.get $n_fb) (i32.const 1)))
              (global.set $block_exec_last_fallback_fn (local.get $a))
              (local.set $wrote (i32.const 0)))

            ;; Writeback R[d].
            (if (local.get $wrote)
              (then
                (block $sdone
                (block $s7 (block $s6 (block $s5 (block $s4
                (block $s3 (block $s2 (block $s1 (block $s0
                  (br_table $s0 $s1 $s2 $s3 $s4 $s5 $s6 $s7 (local.get $d)))
                  (local.set $r0 (local.get $vr)) (br $sdone))
                  (local.set $r1 (local.get $vr)) (br $sdone))
                  (local.set $r2 (local.get $vr)) (br $sdone))
                  (local.set $r3 (local.get $vr)) (br $sdone))
                  (local.set $r4 (local.get $vr)) (br $sdone))
                  (local.set $r5 (local.get $vr)) (br $sdone))
                  (local.set $r6 (local.get $vr)) (br $sdone))
                (local.set $r7 (local.get $vr)))))
            (br $body)))

        (local.set $nblk (i32.add (local.get $nblk) (i32.const 1)))
        (local.set $nsteps (i32.add (local.get $nsteps) (local.get $cost)))
        (local.set $nuops_run (i32.add (local.get $nuops_run) (local.get $nuops)))
        ;; term_kind 5 -- THE THREADED TAIL. The block's own terminator was left
        ;; in the thread stream immediately after the descriptor instead of
        ;; being folded, so there is no condition to evaluate and no successor
        ;; to pick: publish everything and walk into it. This is the shape every
        ;; install from $block_exec_try_install has today, and it is what makes
        ;; a plain basic block expressible as a one-block region.
        (if (i32.eq (local.get $term_kind) (i32.const 5))
          (then
            (local.set $tail_exit (i32.const 1))
            (local.set $live_out (i32.const 0xFF))
            (br $done)))
        ;; Which edge. term_kind 4 is an unconditional one -- a block that ends
        ;; in a `jmp`, or one that simply falls into its successor -- and it
        ;; evaluates no condition at all. Everything else evaluates the same
        ;; $eval_cc the scalar Jcc would have, off the same globals, so all
        ;; sixteen conditions are exact here for free.
        (local.set $next_b (local.get $succ_f))
        (if (i32.ne (local.get $term_kind) (i32.const 4))
          (then
            (if (call $eval_cc (local.get $term_cc))
              (then (local.set $next_b (local.get $succ_t))))))
        ;; A modelled exit. Publishes THIS exit's live-out mask: which
        ;; registers the region defined on the paths that can reach it is a
        ;; per-exit fact, not a per-region one.
        (if (i32.lt_s (local.get $next_b) (i32.const 0))
          (then
            (local.set $up
              (i32.add (local.get $EX)
                (i32.shl (i32.sub (i32.const -1) (local.get $next_b))
                         (i32.const 3))))
            (local.set $exit_eip (i32.load          (local.get $up)))
            (local.set $live_out (i32.load offset=4 (local.get $up)))
            (br $done)))
        ;; A breakpoint on an INTERIOR block's entry. $run checks $bp_addr at
        ;; block entries, and a region's interior edges are block entries that
        ;; $run never sees -- so without this a `--break=` inside a folded loop
        ;; would fire on the first entry and then never again, which is a
        ;; debugger that lies. Leaving through the ordinary side-exit hands the
        ;; address to $run, which halts (and arms $bp_skip_once) exactly as it
        ;; does for the unfolded graph. Guarded on the global, so an ordinary
        ;; run pays one already-hot load per block edge and no branch taken.
        (if (global.get $bp_addr)
          (then
            (local.set $exit_eip
              (i32.load offset=48
                (i32.add (local.get $BR)
                  (i32.mul (local.get $next_b)
                    (i32.shl (global.get $REGION_BLOCK_WORDS) (i32.const 2))))))
            (if (i32.eq (local.get $exit_eip) (global.get $bp_addr))
              (then
                (local.set $side (i32.const 1))
                (br $done)))))
        ;; Safepoint. The only place either meter is allowed to stop the run is
        ;; a block edge, because that is the only place the guest is in a state
        ;; the rest of the emulator can read: every register is a value in a
        ;; local about to be published, no instruction is half-retired, and the
        ;; EIP the run resumes at is a real basic-block entry.
        ;; What the fallbacks have spent so far is the drop in the parked
        ;; counter -- it only ever falls, so this is a running total and needs
        ;; no re-parking. Without it a region whose blocks are mostly fallbacks
        ;; would run past its step budget by whatever those handlers charged.
        (if (i32.or (i32.ge_u
                      (i32.add (local.get $nsteps)
                        (i32.sub (i32.const 0x100000) (global.get $steps)))
                      (local.get $steps_avail))
                    (i32.ge_u (local.get $nblk) (local.get $budget_avail)))
          (then
            (local.set $side (i32.const 1))
            (local.set $exit_eip
              (i32.load offset=48
                (i32.add (local.get $BR)
                  (i32.mul (local.get $next_b)
                    (i32.shl (global.get $REGION_BLOCK_WORDS) (i32.const 2))))))
            (br $done)))
        (local.set $cur (local.get $next_b))
        (br $trip)))

    ;; Exit materialization. The live-out mask is what the descriptor proved
    ;; the body writes; a register outside it holds the value it entered with,
    ;; so publishing it would be a no-op and skipping it is not an omission.
    ;; This runs on BOTH kinds of exit -- a modelled one, with its own mask,
    ;; and the budget-exhausted side exit, which publishes all eight because it
    ;; resumes at a block entry rather than at a modelled exit and no mask in
    ;; the descriptor describes what is live there.
    (if (local.get $side) (then (local.set $live_out (i32.const 0xFF))))
    (if (i32.and (local.get $live_out) (i32.const 0x01)) (then (global.set $eax (local.get $r0))))
    (if (i32.and (local.get $live_out) (i32.const 0x02)) (then (global.set $ecx (local.get $r1))))
    (if (i32.and (local.get $live_out) (i32.const 0x04)) (then (global.set $edx (local.get $r2))))
    (if (i32.and (local.get $live_out) (i32.const 0x08)) (then (global.set $ebx (local.get $r3))))
    (if (i32.and (local.get $live_out) (i32.const 0x10)) (then (global.set $esp (local.get $r4))))
    (if (i32.and (local.get $live_out) (i32.const 0x20)) (then (global.set $ebp (local.get $r5))))
    (if (i32.and (local.get $live_out) (i32.const 0x40)) (then (global.set $esi (local.get $r6))))
    (if (i32.and (local.get $live_out) (i32.const 0x80)) (then (global.set $edi (local.get $r7))))

    ;; The H149 pair once more: a native producer parked its address in a local
    ;; that nothing outside this frame can see, and the consumer may be the
    ;; first op after the region. One store, on the cold path.
    (global.set $ea_temp (local.get $ea_hold))

    (global.set $tree_fold_iters
      (i64.add (global.get $tree_fold_iters) (i64.extend_i32_u (local.get $nblk))))
    (global.set $tree_fold_ops
      (i64.add (global.get $tree_fold_ops) (i64.extend_i32_u (local.get $nsteps))))
    (global.set $block_exec_runs
      (i32.add (global.get $block_exec_runs) (i32.const 1)))
    (global.set $block_exec_native_ops
      (i64.add (global.get $block_exec_native_ops)
        (i64.extend_i32_u (i32.sub (local.get $nuops_run) (local.get $n_fb)))))
    (global.set $block_exec_fallback_ops
      (i64.add (global.get $block_exec_fallback_ops)
        (i64.extend_i32_u (local.get $n_fb))))
    ;; Transfers the region did NOT make: one per interior block edge. This is
    ;; the second term of the cost model -- ns/entry against ns/op -- and it is
    ;; the only one the histogram cannot recover, because a folded edge leaves
    ;; no trace anywhere else.
    (global.set $block_exec_transfers_saved
      (i64.add (global.get $block_exec_transfers_saved)
        (i64.extend_i32_u (i32.sub (local.get $nblk) (i32.const 1)))))
    ;; Coverage BY REGION SIZE. One store pair per region exit, on the cold
    ;; path out of the trip loop, and the only place the descriptor's own
    ;; $nblocks is joined to the work it did -- $block_exec_native_ops sums
    ;; every size together and cannot answer "how much of this app runs in a
    ;; 2-4 block region", which is the question the census asked.
    ;; Clamped, because $nblocks comes out of the descriptor and a descriptor
    ;; can be hand-fed through set_region_spec; an unclamped index here would
    ;; be a store past the end of $BX_RG_BASE.
    (local.set $nb_clamped
      (select (global.get $REGION_MAX_BLOCKS) (local.get $nblocks)
              (i32.gt_u (local.get $nblocks) (global.get $REGION_MAX_BLOCKS))))
    (local.set $ea (call $bx_rg_word
      (i32.add (global.get $BX_RG_ENTN_OFF) (local.get $nb_clamped))))
    (i32.store (local.get $ea) (i32.add (i32.load (local.get $ea)) (i32.const 1)))
    (local.set $ea (call $bx_rg_word
      (i32.add (global.get $BX_RG_OPSN_OFF) (i32.shl (local.get $nb_clamped) (i32.const 1)))))
    (i64.store (local.get $ea)
      (i64.add (i64.load (local.get $ea)) (i64.extend_i32_u (local.get $nuops_run))))

    ;; Pacing, settled once. $next already billed one step for the dispatch that
    ;; entered here and $run already billed one block, so charge the rest: the
    ;; guest ops every block execution stood for, what the fallbacks actually
    ;; spent (measured as the drop in the parked counter), and the interior
    ;; transfers. The transfer OUT of the region is charged by $branch_end (or,
    ;; on a threaded tail, by the terminator itself), exactly as the unfolded
    ;; graph would have charged it.
    (local.set $fb_used (i32.sub (i32.const 0x100000) (global.get $steps)))
    (global.set $steps
      (i32.sub (local.get $steps_in)
        (i32.sub (i32.add (local.get $nsteps) (local.get $fb_used))
                 (i32.const 1))))
    (global.set $block_budget
      (i32.sub (global.get $block_budget)
        (i32.sub (local.get $nblk) (i32.const 1))))

    ;; A threaded tail does not leave the region through an edge at all: the
    ;; block's own terminator is the next op in the stream. If $steps went
    ;; non-positive above, $next takes the ordinary out-of-steps path and parks
    ;; $resume_ip HERE -- a real op boundary with every register published.
    (if (local.get $tail_exit)
      (then
        (global.set $ip (local.get $tail_ip))
        (return_call $next)))

    ;; A side exit resumes at the entry EIP of the block it was about to run:
    ;; the guest state is fully materialized, so the region is re-entered (or,
    ;; if the resume point is an interior block, that block is decoded on its
    ;; own) as if the graph had simply been interrupted at an edge -- which it
    ;; was.
    (global.set $eip (local.get $exit_eip))
    (return_call $branch_end))
