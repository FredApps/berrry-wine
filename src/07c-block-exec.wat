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
  (global $block_exec_min_uops (mut i32) (i32.const 12))
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

  ;; Micro-op kinds, DENSE and this file's own, mapped from the $TU_* space at
  ;; decode time by $bx_kind_for_tu. Dense because the executor dispatches with
  ;; a br_table and the $TU_* space has holes here (IMUL, ADC/SBB, REP and the
  ;; x87 forms are deliberately fallbacks in this prototype). The SIB forms are
  ;; kept contiguous AT THE TOP so the effective-address hoist sits behind one
  ;; range test, exactly as in H454.
  (global $BX_MOV_RR      i32 (i32.const 0))
  (global $BX_MOV_RI      i32 (i32.const 1))
  (global $BX_LEA_RO      i32 (i32.const 2))
  (global $BX_ADD_RR      i32 (i32.const 3))
  (global $BX_ADD_RI      i32 (i32.const 4))
  (global $BX_SUB_RR      i32 (i32.const 5))
  (global $BX_SUB_RI      i32 (i32.const 6))
  (global $BX_AND_RR      i32 (i32.const 7))
  (global $BX_AND_RI      i32 (i32.const 8))
  (global $BX_OR_RR       i32 (i32.const 9))
  (global $BX_OR_RI       i32 (i32.const 10))
  (global $BX_XOR_RR      i32 (i32.const 11))
  (global $BX_XOR_RI      i32 (i32.const 12))
  (global $BX_INC         i32 (i32.const 13))
  (global $BX_DEC         i32 (i32.const 14))
  (global $BX_NEG         i32 (i32.const 15))
  (global $BX_NOT         i32 (i32.const 16))
  (global $BX_SHIFT       i32 (i32.const 17))
  (global $BX_LOAD32      i32 (i32.const 18))
  (global $BX_STORE32     i32 (i32.const 19))
  (global $BX_LOAD32_ABS  i32 (i32.const 20))
  (global $BX_STORE32_ABS i32 (i32.const 21))
  (global $BX_MOV_SUB_RR  i32 (i32.const 22))
  (global $BX_MOV_SUB_RI  i32 (i32.const 23))
  (global $BX_ALU_SUB_RR  i32 (i32.const 24))
  (global $BX_ALU_SUB_RI  i32 (i32.const 25))
  (global $BX_LOAD8_RO    i32 (i32.const 26))
  (global $BX_STORE8_RO   i32 (i32.const 27))
  (global $BX_LOAD8_ABS   i32 (i32.const 28))
  (global $BX_STORE8_ABS  i32 (i32.const 29))
  (global $BX_MOVZX8_RO   i32 (i32.const 30))
  (global $BX_MOVSX8_RO   i32 (i32.const 31))
  (global $BX_LOAD16_ABS  i32 (i32.const 32))
  (global $BX_LOAD16_RO   i32 (i32.const 33))
  (global $BX_STORE16_RO  i32 (i32.const 34))
  ;; This file's own three. The stack forms are 1.6%+ of heroes2 and H454's
  ;; vocabulary has no kind for them, because a self-loop rarely pushes.
  (global $BX_PUSH_R      i32 (i32.const 35))
  (global $BX_POP_R       i32 (i32.const 36))
  (global $BX_PUSH_I      i32 (i32.const 37))
  ;; Must be BELOW $BX_FIRST_SIB: a fallback carries no SIB fields and must not
  ;; pay the effective-address hoist.
  (global $BX_FALLBACK    i32 (i32.const 38))
  (global $BX_FIRST_SIB   i32 (i32.const 39))
  (global $BX_LEA_SIB     i32 (i32.const 39))
  (global $BX_LOAD32_SIB  i32 (i32.const 40))
  (global $BX_STORE32_SIB i32 (i32.const 41))
  (global $BX_MOVSX8_SIB  i32 (i32.const 42))
  (global $BX_STORE8_SIB  i32 (i32.const 43))
  (global $BX_EA_SIB      i32 (i32.const 44))
  (global $BX_EA_SIB_LD8  i32 (i32.const 45))
  (global $BX_MAX_KIND    i32 (i32.const 45))

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

  ;; $TU_* -> $BX_*, or -1 for "this prototype does not implement it, take the
  ;; fallback". Arithmetic rather than a table because the two spaces were laid
  ;; out to make it arithmetic; a hole here is a deliberate scope decision, not
  ;; a correctness one, and every one of them is listed in the design doc.
  (func $bx_kind_for_tu (param $tu i32) (result i32)
    ;; 0..17 map one-to-one (MOV/LEA/ALU/INC/DEC/NEG/NOT/SHIFT)
    (if (i32.le_u (local.get $tu) (i32.const 17))
      (then (return (local.get $tu))))
    ;; 18,19 IMUL -> fallback
    ;; 20..33 (LOAD/STORE 32, the ABS forms, the sub-register forms, the byte
    ;; forms, MOVZX/MOVSX) shift down by the two IMUL holes
    (if (i32.and (i32.ge_u (local.get $tu) (i32.const 20))
                 (i32.le_u (local.get $tu) (i32.const 33)))
      (then (return (i32.sub (local.get $tu) (i32.const 2)))))
    ;; 40..42 the 16-bit memory forms
    (if (i32.and (i32.ge_u (local.get $tu) (i32.const 40))
                 (i32.le_u (local.get $tu) (i32.const 42)))
      (then (return (i32.sub (local.get $tu) (i32.const 8)))))
    ;; 34..38 the SIB forms, lifted to the top of the dense space
    (if (i32.and (i32.ge_u (local.get $tu) (i32.const 34))
                 (i32.le_u (local.get $tu) (i32.const 38)))
      (then (return (i32.add (local.get $tu) (i32.const 5)))))
    ;; 47,48 the H149 effective-address pair
    (if (i32.eq (local.get $tu) (i32.const 47)) (then (return (i32.const 44))))
    (if (i32.eq (local.get $tu) (i32.const 48)) (then (return (i32.const 45))))
    ;; 39 MOV_M8_I_SIB, 43..46 ADC/SBB, 49..53 REP and the x87 forms
    (i32.const -1))

  ;; Where the descriptor is BUILT. Writing it forward from $tstart would
  ;; overwrite the very ops still being read -- a 24-byte micro-op over an
  ;; 8-byte op clobbers on the third instruction -- so it is assembled in the
  ;; far half of OP_INDEX (the same scratch $loop_try_tree_fold uses, and never
  ;; at the same time) and copied out once the whole block has been accepted.
  (func $bx_scratch (result i32)
    (i32.add (global.get $OP_INDEX) (i32.shr_u (global.get $OP_INDEX_SIZE) (i32.const 1))))
  (func $bx_scratch_words (result i32)
    (i32.shr_u (global.get $OP_INDEX_SIZE) (i32.const 3)))

  ;; ----------------------------------------------------------------------
  ;; $block_exec_try_install -- the matcher. Called from $decode_block AFTER
  ;; $loop_match_block, so every specialised family keeps priority; a block one
  ;; of them claimed set $op_index_n to 0 and is declined here on the first
  ;; test.
  ;; ----------------------------------------------------------------------
  (func $block_exec_try_install (param $start_eip i32) (param $tstart i32) (result i32)
    (local $n i32) (local $i i32) (local $p i32) (local $pn i32) (local $fn i32)
    (local $tail_p i32) (local $tail_bytes i32) (local $tail_words i32)
    (local $sc i32) (local $base i32) (local $cap i32)
    (local $words i32) (local $nuops i32) (local $k i32) (local $nw i32)
    (local $j i32) (local $total i32) (local $extra i32)

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
    ;; The near half of OP_INDEX holds this block's op addresses. Past its
    ;; halfway point those entries ARE the scratch, so building a descriptor
    ;; would eat the input.
    (if (i32.ge_u (local.get $n) (local.get $cap))
      (then (global.set $block_exec_decl_why (i32.const 5))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))
    ;; body ops = n - 1 (the terminator is not ours)
    (if (i32.lt_u (local.get $n)
                  (i32.add (global.get $block_exec_min_uops) (i32.const 1)))
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
        ;; room for one native micro-op, before anything is written
        (if (i32.gt_u (i32.add (local.get $sc)
                        (i32.add (global.get $BX_UOP_WORDS) (local.get $tail_words)))
                      (local.get $cap))
          (then (global.set $block_exec_decl_why (i32.const 5))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0))))

        (local.set $k (i32.const -1))
        ;; This file's own three kinds first: PUSH/POP r32 carry the register
        ;; in the HANDLER index (323..338), and $tree_uop_classify has no kind
        ;; for them at all.
        (if (i32.and (i32.ge_u (local.get $fn) (i32.const 323))
                     (i32.le_u (local.get $fn) (i32.const 330)))
          (then
            (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $BX_PUSH_R))
            (i32.store offset=4 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.sub (local.get $fn) (i32.const 323)))
            (i32.store offset=8 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (i32.store offset=12 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (i32.store offset=16 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (local.get $fn))
            (i32.store offset=20 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (local.set $sc (i32.add (local.get $sc) (global.get $BX_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        (if (i32.and (i32.ge_u (local.get $fn) (i32.const 331))
                     (i32.le_u (local.get $fn) (i32.const 338)))
          (then
            (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $BX_POP_R))
            (i32.store offset=4 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.sub (local.get $fn) (i32.const 331)))
            (i32.store offset=8 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (i32.store offset=12 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (i32.store offset=16 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (local.get $fn))
            (i32.store offset=20 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (local.set $sc (i32.add (local.get $sc) (global.get $BX_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))
        ;; PUSH imm32 -- one inline word, no register at all.
        (if (i32.and (i32.eq (local.get $fn) (i32.const 34))
                     (i32.eq (i32.sub (local.get $pn) (local.get $p)) (i32.const 12)))
          (then
            (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $BX_PUSH_I))
            (i32.store offset=4 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (i32.store offset=8 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (i32.store offset=12 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.load offset=8 (local.get $p)))
            (i32.store offset=16 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (local.get $fn))
            (i32.store offset=20 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (i32.const 0))
            (local.set $sc (i32.add (local.get $sc) (global.get $BX_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))

        ;; H454's classifier, unchanged. One classifier, one `b` layout.
        (if (call $tree_uop_classify (local.get $p))
          (then (local.set $k (call $bx_kind_for_tu (global.get $tu_kind)))))

        (if (i32.ge_s (local.get $k) (i32.const 0))
          (then
            ;; Steps this op bills BEYOND the one $next charges for its own
            ;; dispatch. H420 is the only one, and it charges a step because it
            ;; swallowed a separate SIB-EA dispatch. Carrying it matters even
            ;; though nothing architectural depends on it: `--block-exec` must
            ;; not silently buy the guest more work per batch than the threaded
            ;; arm got, or every fixed-batch A/B below is comparing two
            ;; different amounts of guest execution and reads as a speedup.
            (local.set $extra (i32.add (local.get $extra) (global.get $tu_extra)))
            (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (local.get $k))
            (i32.store offset=4 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $tu_d))
            (i32.store offset=8 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $tu_a))
            (i32.store offset=12 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $tu_imm))
            (i32.store offset=16 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $tu_fn))
            (i32.store offset=20 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                       (global.get $tu_b))
            (local.set $sc (i32.add (local.get $sc) (global.get $BX_UOP_WORDS)))
            (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $scan)))

        ;; ---- fallback: 6 header words, the op's own inline words verbatim,
        ;; then the H459 resume trampoline the handler's `return_call $next`
        ;; will land on.
        (local.set $nw (i32.shr_u
          (i32.sub (i32.sub (local.get $pn) (local.get $p)) (i32.const 8))
          (i32.const 2)))
        (if (i32.gt_u (i32.add (local.get $sc)
              (i32.add (i32.add (global.get $BX_UOP_WORDS) (local.get $nw))
                       (i32.add (i32.const 2) (local.get $tail_words))))
                      (local.get $cap))
          (then (global.set $block_exec_decl_why (i32.const 5))
                (global.set $block_exec_declines
                  (i32.add (global.get $block_exec_declines) (i32.const 1)))
                (return (i32.const 0))))
        (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (global.get $BX_FALLBACK))
        (i32.store offset=4 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (i32.const 0))
        ;; `a` is unused by the fallback arm, so it carries the inline-word
        ;; count instead. Only --trace-block-exec reads it, and it needs it:
        ;; without it a reader striding 6 words per micro-op walks straight
        ;; into a handler's copied operands and prints them as micro-ops.
        (i32.store offset=8 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (local.get $nw))
        ;; the handler's own operand word rides in `imm`
        (i32.store offset=12 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (i32.load offset=4 (local.get $p)))
        (i32.store offset=16 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (local.get $fn))
        (i32.store offset=20 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (i32.const 0))
        (local.set $sc (i32.add (local.get $sc) (global.get $BX_UOP_WORDS)))
        (local.set $j (i32.const 0))
        (block $cp_done
          (loop $cp
            (br_if $cp_done (i32.ge_u (local.get $j) (local.get $nw)))
            (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
              (i32.load (i32.add (local.get $p)
                (i32.add (i32.const 8) (i32.shl (local.get $j) (i32.const 2))))))
            (local.set $sc (i32.add (local.get $sc) (i32.const 1)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $cp)))
        (i32.store (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (global.get $BX_RESUME_HANDLER))
        (i32.store offset=4 (i32.add (local.get $base) (i32.shl (local.get $sc) (i32.const 2)))
                   (i32.const 0))
        (local.set $sc (i32.add (local.get $sc) (i32.const 2)))
        (local.set $nuops (i32.add (local.get $nuops) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))

    (local.set $words (local.get $sc))
    (if (i32.or
          (i32.lt_u (local.get $nuops) (global.get $block_exec_min_uops))
          (i32.and (i32.ne (global.get $block_exec_max_uops) (i32.const 0))
                   (i32.gt_u (local.get $nuops) (global.get $block_exec_max_uops))))
      (then (global.set $block_exec_decl_why (i32.const 1))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))

    ;; ---- the emit slack, DERIVED. $decode_block reserves 4096 bytes past
    ;; $thread_alloc before $te signals a flush, and a descriptor past it
    ;; corrupts the next block silently instead of failing.
    (local.set $total
      (i32.add (i32.add (i32.const 8) (i32.shl (global.get $BX_HEADER_WORDS) (i32.const 2)))
               (i32.add (i32.shl (local.get $words) (i32.const 2)) (local.get $tail_bytes))))
    (if (i32.gt_u (local.get $total) (i32.const 4096))
      (then (global.set $block_exec_decl_why (i32.const 4))
            (global.set $block_exec_declines
              (i32.add (global.get $block_exec_declines) (i32.const 1)))
            (return (i32.const 0))))

    ;; Copy the terminator into the scratch before the descriptor overwrites
    ;; the arena it currently lives in.
    (local.set $j (i32.const 0))
    (block $tl_done
      (loop $tl
        (br_if $tl_done (i32.ge_u (local.get $j) (local.get $tail_words)))
        (i32.store (i32.add (local.get $base)
                     (i32.shl (i32.add (local.get $words) (local.get $j)) (i32.const 2)))
          (i32.load (i32.add (local.get $tail_p) (i32.shl (local.get $j) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $tl)))

    ;; ---- emit ----
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $BX_HANDLER) (i32.const 0))
    (call $te_raw (local.get $nuops))
    (call $te_raw (local.get $words))
    (call $te_raw (local.get $start_eip))
    ;; +12 -- the steps the NATIVE micro-ops bill beyond one each. See the
    ;; $tu_extra note above; the fallbacks bill themselves and are measured at
    ;; run time instead of predicted here.
    (call $te_raw (local.get $extra))
    (local.set $j (i32.const 0))
    (block $em_done
      (loop $em
        (br_if $em_done (i32.ge_u (local.get $j) (local.get $words)))
        (call $te_raw
          (i32.load (i32.add (local.get $base) (i32.shl (local.get $j) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $em)))
    ;; The terminator goes back through $te, not $te_raw, so OP_INDEX records
    ;; it as the block's last op at its new address -- which is what keeps
    ;; $decode_run's `optr + 16 == d_block_end` adjacency test working and lets
    ;; it patch the fall-through bit into the Jcc operand word.
    (call $te
      (i32.load (i32.add (local.get $base) (i32.shl (local.get $words) (i32.const 2))))
      (i32.load (i32.add (local.get $base)
                  (i32.shl (i32.add (local.get $words) (i32.const 1)) (i32.const 2)))))
    (local.set $j (i32.const 2))
    (block $tw_done
      (loop $tw
        (br_if $tw_done (i32.ge_u (local.get $j) (local.get $tail_words)))
        (call $te_raw
          (i32.load (i32.add (local.get $base)
                      (i32.shl (i32.add (local.get $words) (local.get $j)) (i32.const 2)))))
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
            ;; A fallback is 6 words + its copied inline words + the 2-word
            ;; H459 resume op; everything else is exactly 6.
            (local.set $j (i32.add (local.get $j)
              (select
                (i32.add (global.get $BX_UOP_WORDS)
                  (i32.add (i32.const 2)
                    (i32.load offset=8
                      (i32.add (local.get $base) (i32.shl (local.get $j) (i32.const 2))))))
                (global.get $BX_UOP_WORDS)
                (i32.eq
                  (i32.load (i32.add (local.get $base) (i32.shl (local.get $j) (i32.const 2))))
                  (global.get $BX_FALLBACK)))))
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
  ;; H458 -- the executor.
  ;; ----------------------------------------------------------------------
  (func $th_block_exec (param $op i32)
    (local $tp i32) (local $up i32) (local $unext i32) (local $tail_ip i32)
    (local $nuops i32) (local $words i32) (local $i i32)
    (local $steps_in i32)
    (local $r0 i32) (local $r1 i32) (local $r2 i32) (local $r3 i32)
    (local $r4 i32) (local $r5 i32) (local $r6 i32) (local $r7 i32)
    (local $kind i32) (local $d i32) (local $a i32) (local $imm i32) (local $b i32)
    (local $va i32) (local $vb i32) (local $vr i32) (local $wrote i32)
    (local $sh_d i32) (local $sh_a i32) (local $mask i32) (local $ssh i32)
    (local $nof i32) (local $ea i32) (local $ea_hold i32)
    (local $n_fb i32)

    (local.set $tp (global.get $ip))
    (local.set $nuops (i32.load (local.get $tp)))
    (local.set $words (i32.load offset=4 (local.get $tp)))
    (local.set $up (i32.add (local.get $tp)
                     (i32.shl (global.get $BX_HEADER_WORDS) (i32.const 2))))
    (local.set $tail_ip (i32.add (local.get $up) (i32.shl (local.get $words) (i32.const 2))))

    ;; Registers into locals. All eight, unconditionally: a live-in mask buys
    ;; nothing and the region bench measured publication of all eight as below
    ;; the noise floor.
    (local.set $r0 (global.get $eax))
    (local.set $r1 (global.get $ecx))
    (local.set $r2 (global.get $edx))
    (local.set $r3 (global.get $ebx))
    (local.set $r4 (global.get $esp))
    (local.set $r5 (global.get $ebp))
    (local.set $r6 (global.get $esi))
    (local.set $r7 (global.get $edi))

    ;; $steps is parked for the duration. A fallback's own $next decrements it
    ;; and, at zero, returns WITHOUT running the resume op -- which from here
    ;; is indistinguishable from a completed instruction, so the op would be
    ;; silently skipped. The true value is computed on the way out.
    (local.set $steps_in (global.get $steps))
    (global.set $steps (i32.const 0x100000))
    (global.set $block_exec_runs (i32.add (global.get $block_exec_runs) (i32.const 1)))

    (block $body_done
      (loop $body
        (br_if $body_done (i32.ge_u (local.get $i) (local.get $nuops)))
        (local.set $kind (i32.load           (local.get $up)))
        (local.set $d    (i32.load offset=4  (local.get $up)))
        (local.set $a    (i32.load offset=8  (local.get $up)))
        (local.set $imm  (i32.load offset=12 (local.get $up)))
        (local.set $b    (i32.load offset=20 (local.get $up)))
        ;; Op totals stay comparable with a --block-exec-off build: re-record
        ;; the ORIGINAL handler index, as H428 and H454 do.
        (if (global.get $handler_hist_enabled)
          (then (call $handler_hist_record (i32.load offset=16 (local.get $up)))))
        (local.set $unext (i32.add (local.get $up) (i32.const 24)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))

        ;; R[d] and R[a] by index -- a br_table each, but over LOCALS. No
        ;; memory traffic and no call: this is the $get_reg the attribution
        ;; priced at 8-12% of guest CPU, deleted rather than made cheaper.
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

        ;; Sub-register lane, width, dead-flag bit and the H149 pair's join --
        ;; the same branchless `b` decode H454 uses, over the same bit layout.
        (local.set $sh_d (i32.and (i32.shr_u (local.get $b) (i32.const 3)) (i32.const 8)))
        (local.set $sh_a (i32.and (i32.shr_u (local.get $b) (i32.const 4)) (i32.const 8)))
        (local.set $mask
          (select (i32.const 0xFFFF) (i32.const 0xFF)
                  (i32.and (local.get $b) (global.get $TU_B_WORD))))
        (local.set $ssh
          (select (i32.const 15) (i32.const 7)
                  (i32.and (local.get $b) (global.get $TU_B_WORD))))
        (local.set $nof (i32.and (local.get $b) (global.get $TU_B_NOFLAGS)))
        (local.set $imm
          (select (local.get $ea_hold) (local.get $imm)
                  (i32.and (local.get $b) (global.get $TU_B_EA))))

        ;; SIB effective address, hoisted behind one range test.
        (if (i32.ge_u (local.get $kind) (global.get $BX_FIRST_SIB))
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
                    (i32.and (i32.shr_u (local.get $b) (i32.const 4)) (i32.const 3)))))))))

        (local.set $wrote (i32.const 1))
        (block $kdone
          (block $k45 (block $k44 (block $k43 (block $k42 (block $k41
          (block $k40 (block $k39 (block $k38 (block $k37 (block $k36
          (block $k35 (block $k34 (block $k33 (block $k32 (block $k31
          (block $k30 (block $k29 (block $k28 (block $k27 (block $k26
          (block $k25 (block $k24 (block $k23 (block $k22 (block $k21
          (block $k20 (block $k19 (block $k18 (block $k17 (block $k16
          (block $k15 (block $k14 (block $k13 (block $k12 (block $k11
          (block $k10 (block $k09 (block $k08 (block $k07 (block $k06
          (block $k05 (block $k04 (block $k03 (block $k02 (block $k01
          (block $k00
            (br_table $k00 $k01 $k02 $k03 $k04 $k05 $k06 $k07 $k08 $k09
                      $k10 $k11 $k12 $k13 $k14 $k15 $k16 $k17 $k18 $k19
                      $k20 $k21 $k22 $k23 $k24 $k25 $k26 $k27 $k28 $k29
                      $k30 $k31 $k32 $k33 $k34 $k35 $k36 $k37 $k38 $k39
                      $k40 $k41 $k42 $k43 $k44 $k45
                      $k45
                      (local.get $kind)))
            ;; 0 MOV_RR
            (local.set $vr (local.get $vb)) (br $kdone))
            ;; 1 MOV_RI
            (local.set $vr (local.get $imm)) (br $kdone))
            ;; 2 LEA_RO -- LEA never touches flags
            (local.set $vr (i32.add (local.get $vb) (local.get $imm))) (br $kdone))
            ;; 3 ADD_RR
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
            ;; 17 SHIFT -- $do_shift32 owns the flag contract, count==0 included
            (local.set $vr
              (call $do_shift32 (local.get $a) (local.get $va) (local.get $imm)))
            (br $kdone))
            ;; 18 LOAD32
            (local.set $vr (call $gl32 (i32.add (local.get $vb) (local.get $imm))))
            (br $kdone))
            ;; 19 STORE32 -- through $gs32, which is what keeps SMC
            ;; invalidation and page crossing identical to the scalar path.
            (call $gs32 (i32.add (local.get $vb) (local.get $imm)) (local.get $va))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 20 LOAD32_ABS
            (local.set $vr (call $gl32 (local.get $imm))) (br $kdone))
            ;; 21 STORE32_ABS
            (call $gs32 (local.get $imm) (local.get $va))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 22 MOV_SUB_RR -- extract from the source lane, insert into the
            ;; destination lane, leaving every other bit of the container as it
            ;; was. Exact, not an approximation.
            (local.set $vr
              (i32.or
                (i32.and (local.get $va)
                  (i32.xor (i32.shl (local.get $mask) (local.get $sh_d)) (i32.const -1)))
                (i32.shl
                  (i32.and (i32.shr_u (local.get $vb) (local.get $sh_a)) (local.get $mask))
                  (local.get $sh_d))))
            (br $kdone))
            ;; 23 MOV_SUB_RI
            (local.set $vr
              (i32.or
                (i32.and (local.get $va)
                  (i32.xor (i32.shl (local.get $mask) (local.get $sh_d)) (i32.const -1)))
                (i32.shl (i32.and (local.get $imm) (local.get $mask)) (local.get $sh_d))))
            (br $kdone))
            ;; 24 ALU_SUB_RR -- $do_alu_sized owns the flag contract at this
            ;; width; sub-op 7 is CMP and writes no register.
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
            ;; 25 ALU_SUB_RI
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
            ;; 26 LOAD8_RO
            (local.set $vr
              (i32.or
                (i32.and (local.get $va)
                  (i32.xor (i32.shl (i32.const 0xFF) (local.get $sh_d)) (i32.const -1)))
                (i32.shl (call $gl8 (i32.add (local.get $vb) (local.get $imm)))
                         (local.get $sh_d))))
            (br $kdone))
            ;; 27 STORE8_RO
            (call $gs8 (i32.add (local.get $vb) (local.get $imm))
              (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (i32.const 0xFF)))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 28 LOAD8_ABS
            (local.set $vr
              (i32.or
                (i32.and (local.get $va)
                  (i32.xor (i32.shl (i32.const 0xFF) (local.get $sh_d)) (i32.const -1)))
                (i32.shl (call $gl8 (local.get $imm)) (local.get $sh_d))))
            (br $kdone))
            ;; 29 STORE8_ABS
            (call $gs8 (local.get $imm)
              (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (i32.const 0xFF)))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 30 MOVZX8_RO -- narrow read, WHOLE destination written
            (local.set $vr (call $gl8 (i32.add (local.get $vb) (local.get $imm))))
            (br $kdone))
            ;; 31 MOVSX8_RO
            (local.set $vr
              (call $sign_ext8 (call $gl8 (i32.add (local.get $vb) (local.get $imm)))))
            (br $kdone))
            ;; 32 LOAD16_ABS -- low half only; the container's top half survives
            (local.set $vr
              (i32.or (i32.and (local.get $va) (i32.const 0xFFFF0000))
                      (call $gl16 (local.get $imm))))
            (br $kdone))
            ;; 33 LOAD16_RO
            (local.set $vr
              (i32.or (i32.and (local.get $va) (i32.const 0xFFFF0000))
                      (call $gl16 (i32.add (local.get $vb) (local.get $imm)))))
            (br $kdone))
            ;; 34 STORE16_RO
            (call $gs16 (i32.add (local.get $vb) (local.get $imm))
              (i32.and (local.get $va) (i32.const 0xFFFF)))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 35 PUSH_R -- ESP is r4, a local, so the whole push is register
            ;; arithmetic plus one $gs32. `push esp` pushes the OLD esp, which
            ;; is what $va already holds.
            (local.set $r4 (i32.sub (local.get $r4) (i32.const 4)))
            (call $gs32 (local.get $r4) (local.get $va))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 36 POP_R
            (local.set $vr (call $gl32 (local.get $r4)))
            (local.set $r4 (i32.add (local.get $r4) (i32.const 4)))
            (br $kdone))
            ;; 37 PUSH_I
            (local.set $r4 (i32.sub (local.get $r4) (i32.const 4)))
            (call $gs32 (local.get $r4) (local.get $imm))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 38 FALLBACK. Spill all eight -- $gs*/$gl* reach
            ;; $invalidate_code_write and the page compiler, a fault path reads
            ;; the register file to build its report, and every --trace-*
            ;; formatter reads the globals, so a stale one is observable from
            ;; inside the call. This spill is also the publish-before-trap
            ;; guarantee: a handler that traps does so with the register file
            ;; and $eip exactly as the threaded path would have left them.
            (global.set $eax (local.get $r0))
            (global.set $ecx (local.get $r1))
            (global.set $edx (local.get $r2))
            (global.set $ebx (local.get $r3))
            (global.set $esp (local.get $r4))
            (global.set $ebp (local.get $r5))
            (global.set $esi (local.get $r6))
            (global.set $edi (local.get $r7))
            ;; The H149 pair's OTHER half. A native TU_EA_SIB parks its address
            ;; in $ea_hold, a LOCAL -- but a consumer that fell back reads it
            ;; through $read_addr, which substitutes the $ea_temp GLOBAL for a
            ;; $SIB_SENTINEL address word. Nothing else writes that global here,
            ;; so without this the handler addresses whatever the last threaded
            ;; SIB op left behind: a plausible wrong address, a silent wrong
            ;; answer, and a crash an arbitrary distance later. (Quake II
            ;; 0x0043c060 -- H149 followed by H51 `alu dword [ea], imm` -- is the
            ;; block that found it, and it dies six batches downstream.) Both
            ;; directions, because a producer can fall back too: a fallback H149
            ;; writes $ea_temp and the NEXT micro-op may be a native consumer
            ;; reading $ea_hold. Cold path, so neither store is on the fast one.
            (global.set $ea_temp (local.get $ea_hold))
            (global.set $ip (local.get $unext))
            (call_indirect (type $handler_t)
              (local.get $imm)
              (i32.load offset=16 (local.get $up)))
            (local.set $ea_hold (global.get $ea_temp))
            ;; $ip now points one word past the H459 resume op. Read the cursor
            ;; back rather than computing it: a handler that consumes a
            ;; different number of words than expected then cannot desynchronise
            ;; the walk.
            (local.set $unext (global.get $ip))
            (local.set $r0 (global.get $eax))
            (local.set $r1 (global.get $ecx))
            (local.set $r2 (global.get $edx))
            (local.set $r3 (global.get $ebx))
            (local.set $r4 (global.get $esp))
            (local.set $r5 (global.get $ebp))
            (local.set $r6 (global.get $esi))
            (local.set $r7 (global.get $edi))
            (local.set $n_fb (i32.add (local.get $n_fb) (i32.const 1)))
            (global.set $block_exec_last_fallback_fn (i32.load offset=16 (local.get $up)))
            (local.set $wrote (i32.const 0))
            (br $kdone))
            ;; 39 LEA_SIB -- address arithmetic only, no memory and no flags
            (local.set $vr (local.get $ea)) (br $kdone))
            ;; 40 LOAD32_SIB
            (local.set $vr (call $gl32 (local.get $ea))) (br $kdone))
            ;; 41 STORE32_SIB
            (call $gs32 (local.get $ea) (local.get $va))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 42 MOVSX8_SIB
            (local.set $vr (call $sign_ext8 (call $gl8 (local.get $ea)))) (br $kdone))
            ;; 43 STORE8_SIB
            (call $gs8 (local.get $ea)
              (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (i32.const 0xFF)))
            (local.set $wrote (i32.const 0)) (br $kdone))
            ;; 44 EA_SIB -- half an instruction: park the address for the next
            ;; micro-op and write no register.
            (local.set $ea_hold (local.get $ea))
            (local.set $wrote (i32.const 0))
            (br $kdone))
          ;; 45 EA_SIB_LD8 (and the unreachable default) -- the same EA plus
          ;; the byte load H149's operand bit 8 fused into it.
          (local.set $ea_hold (local.get $ea))
          (local.set $vr
            (i32.or
              (i32.and (local.get $va)
                (i32.xor (i32.shl (i32.const 0xFF) (local.get $sh_d)) (i32.const -1)))
              (i32.shl (call $gl8 (local.get $ea)) (local.get $sh_d)))))

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
        (local.set $up (local.get $unext))
        (br $body)))

    ;; Publish. All eight, one exit, no mask -- the region bench measured the
    ;; difference between four and eight as below its noise floor in both
    ;; directions.
    (global.set $eax (local.get $r0))
    (global.set $ecx (local.get $r1))
    (global.set $edx (local.get $r2))
    (global.set $ebx (local.get $r3))
    (global.set $esp (local.get $r4))
    (global.set $ebp (local.get $r5))
    (global.set $esi (local.get $r6))
    (global.set $edi (local.get $r7))
    ;; And the H149 pair's address, for the case the body could not resolve:
    ;; a TU_EA_SIB as the LAST body micro-op has its consumer in the block's
    ;; TERMINATOR, which is still threaded and reads the $ea_temp global.
    ;; Unconditional rather than gated on "did the last uop produce one",
    ;; because the store is one word next to eight that are already going out
    ;; and the gate would be a branch on the same path. Quake II 0x00436b59
    ;; (`xor / mov r8,[..] / lea-EA` into an indexed terminator) is the block
    ;; that needs it.
    (global.set $ea_temp (local.get $ea_hold))

    ;; "served in-loop" against "went out to a handler". The ratio is the
    ;; fraction of the 19-23% ceiling this prototype actually collects.
    (global.set $block_exec_native_ops
      (i64.add (global.get $block_exec_native_ops)
               (i64.extend_i32_u (i32.sub (local.get $nuops) (local.get $n_fb)))))
    (global.set $block_exec_fallback_ops
      (i64.add (global.get $block_exec_fallback_ops)
               (i64.extend_i32_u (local.get $n_fb))))

    ;; Bill the block exactly what the threaded arm would have billed, or a
    ;; fixed-batch A/B stops comparing equal amounts of guest execution and the
    ;; difference reads as a speedup. Four terms:
    ;;
    ;;   native uops           one step each, as $next would have charged
    ;;   + header word 3       what those uops charge on their OWN account
    ;;                         (H420 -- see the installer's note)
    ;;   + (parked - $steps)   what the fallbacks actually consumed, measured
    ;;                         rather than predicted: a fallback handler's own
    ;;                         charge plus the one $next bills for dispatching
    ;;                         the H459 resume op after it, which is exactly
    ;;                         what that op cost threaded
    ;;   - 1                   $next already billed one step to enter H458
    ;;
    ;; The measured third term is why an unfamiliar self-charging handler in
    ;; the fallback set cannot silently change pacing.
    (global.set $steps
      (i32.sub (local.get $steps_in)
        (i32.sub
          (i32.add
            (i32.add (i32.sub (local.get $nuops) (local.get $n_fb))
                     (i32.load offset=12 (local.get $tp)))
            (i32.sub (i32.const 0x100000) (global.get $steps)))
          (i32.const 1))))
    ;; Straight into the block's own terminator, still threaded and untouched.
    ;; If $steps went non-positive, $next takes the ordinary out-of-steps path
    ;; and parks $resume_ip HERE -- a real op boundary with every register
    ;; already published.
    (global.set $ip (local.get $tail_ip))
    (return_call $next))
