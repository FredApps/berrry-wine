  ;; ============================================================
  ;; LOOP-IDIOM MATCHER (Design A)
  ;; ============================================================
  ;; docs/loop-idiom-superops-design.md
  ;;
  ;; Runs once per block, at the end of $decode_block, over the ops that block
  ;; just emitted. Decode-time only -- nothing here is on the $next path.
  ;;
  ;; Op boundaries come from $OP_INDEX, which $te fills in as it emits (design
  ;; 6.1). That is a RECORD of what the decoder did, so it cannot disagree with
  ;; the stream the way a declared word-count table could.
  ;;
  ;; The role table below is a different kind of thing, and is safe for a
  ;; different reason: it is a matcher-side classification whose default is
  ;; "unknown", and an unknown role declines the whole block. A handler this
  ;; file has never heard of costs a missed lowering, never a mis-walk. Extra
  ;; words are only ever read for handlers this file has classified, so the
  ;; walk cannot desynchronize either.

  ;; -- roles ---------------------------------------------------------------
  (global $LR_UNKNOWN i32 (i32.const 0))
  (global $LR_LOAD8   i32 (i32.const 1))  ;; reg8 = byte [base + disp]
  (global $LR_LOAD8S  i32 (i32.const 2))  ;; reg8 = byte [base + index*scale + disp]
  (global $LR_STORE8  i32 (i32.const 3))  ;; byte [base + disp] = reg8
  (global $LR_ADDI    i32 (i32.const 4))  ;; reg += constant
  (global $LR_ZERO    i32 (i32.const 5))  ;; reg = 0 (xor r,r / sub r,r)
  (global $LR_MIRROR  i32 (i32.const 6))  ;; [absolute] = reg
  (global $LR_JCC     i32 (i32.const 7))  ;; conditional branch
  (global $LR_MEMCTR  i32 (i32.const 8))  ;; inc/dec dword [base + disp]
  (global $LR_CMP     i32 (i32.const 9))  ;; compare two registers
  (global $LR_SHIFT   i32 (i32.const 10)) ;; shift/rotate a register
  (global $LR_ADD     i32 (i32.const 11)) ;; add one register to another

  ;; Set from the host: test/run.js --trace-loopmatch[=0xEIP].
  (global $loop_trace (mut i32) (i32.const 0))
  (global $loop_trace_eip (mut i32) (i32.const 0))
  (global $loop_selfloop_blocks (mut i32) (i32.const 0))
  (global $loop_matched_blocks (mut i32) (i32.const 0))
  (global $loop_lut_bounded_matches (mut i32) (i32.const 0))
  (global $loop_lut_runs (mut i32) (i32.const 0))
  (global $loop_lut_bytes (mut i64) (i64.const 0))
  (global $loop_lut16_matches (mut i32) (i32.const 0))
  (global $loop_lut16_runs (mut i32) (i32.const 0))
  (global $loop_lut16_bytes (mut i64) (i64.const 0))
  (global $loop_copy32_matches (mut i32) (i32.const 0))
  (global $loop_copy32_runs (mut i32) (i32.const 0))
  (global $loop_copy32_bytes (mut i64) (i64.const 0))
  (global $loop_avg_matches (mut i32) (i32.const 0))
  (global $loop_avg_runs (mut i32) (i32.const 0))
  (global $loop_avg_pixels (mut i64) (i64.const 0))
  (global $loop_rgb565_alpha_matches (mut i32) (i32.const 0))
  (global $loop_rgb565_alpha_runs (mut i32) (i32.const 0))
  (global $loop_rgb565_alpha_pixels (mut i64) (i64.const 0))
  (global $loop_rgb565_colorkey_matches (mut i32) (i32.const 0))
  (global $loop_rgb565_colorkey_runs (mut i32) (i32.const 0))
  (global $loop_rgb565_colorkey_pixels (mut i64) (i64.const 0))
  (global $loop_mw3_grid_filter_matches (mut i32) (i32.const 0))
  (global $loop_mw3_grid_filter_runs (mut i32) (i32.const 0))
  (global $loop_mw3_grid_filter_cells (mut i64) (i64.const 0))
  (global $loop_aoe_fill_matches (mut i32) (i32.const 0))
  (global $loop_aoe_fill_runs (mut i32) (i32.const 0))
  (global $loop_aoe_fill_bytes (mut i64) (i64.const 0))
  (global $loop_aoe_span_matches (mut i32) (i32.const 0))
  (global $loop_aoe_span_runs (mut i32) (i32.const 0))
  (global $loop_colorkey8_matches (mut i32) (i32.const 0))
  (global $loop_colorkey8_runs (mut i32) (i32.const 0))
  (global $loop_colorkey8_bytes (mut i64) (i64.const 0))
  ;; Generic balanced x87 expression pipeline. Kept opt-in while the first
  ;; production calibration establishes whole-emulator benefit; the matcher
  ;; still counts candidates with execution disabled.
  (global $x87_pipeline4_emit_enabled (mut i32) (i32.const 0))
  (global $x87_pipeline4_matches (mut i32) (i32.const 0))
  (global $x87_pipeline4_runs (mut i32) (i32.const 0))
  (global $x87_tree4_matches (mut i32) (i32.const 0))
  (global $x87_tree4_runs (mut i32) (i32.const 0))
  (global $x87_island_matches (mut i32) (i32.const 0))
  (global $x87_island_runs (mut i32) (i32.const 0))
  (global $x87_affine_emit_enabled (mut i32) (i32.const 0))
  (global $x87_affine_prepare_matches (mut i32) (i32.const 0))
  (global $x87_affine_prepare_runs (mut i32) (i32.const 0))
  (global $x87_affine_finish_matches (mut i32) (i32.const 0))
  (global $x87_affine_finish_runs (mut i32) (i32.const 0))
  ;; LUT_RUN and COPY_RUN have independent gates. The role-proved LUT lowering
  ;; is on by default; COPY remains off while its historical Storm divergence
  ;; is investigated. set_loop_emit still controls both for compatibility.
  (global $loop_lut_emit_enabled (mut i32) (i32.const 1))
  ;; Benchmark/rollback gate for the Heroes III stack-table extension only.
  (global $loop_lut16_stack_emit_enabled (mut i32) (i32.const 1))
  ;; Exact MW3 folds are app-opted-in on the main instance, but guest threads
  ;; execute in separate WebAssembly instances. Keep both their process gate
  ;; (bit 0) and the historically divergent generic COPY/AVG experiment gate
  ;; (bit 1) in shared memory so every decoder sees the same value. Production
  ;; only enables bit 0; bit 1 exists for focused semantic/benchmark A/Bs.
  (global $LOOP_PROCESS_STATE i32 (region.addr $LOOP_PROCESS_STATE 0))
  (global $LOOP_PROCESS_STATE_SIZE i32 (region.size $LOOP_PROCESS_STATE))
  (func $loop_copy_emit_get (result i32)
    (i32.and (i32.atomic.load (global.get $LOOP_PROCESS_STATE)) (i32.const 1)))
  (func $loop_copy_emit_set (param $flag i32)
    (local $state i32)
    (local.set $state (i32.atomic.load (global.get $LOOP_PROCESS_STATE)))
    (i32.atomic.store (global.get $LOOP_PROCESS_STATE)
      (if (result i32) (local.get $flag)
        (then (i32.or (local.get $state) (i32.const 1)))
        (else (i32.and (local.get $state) (i32.const 0xfffffffe))))))
  (func $loop_generic_copy_emit_get (result i32)
    (i32.and (i32.atomic.load (global.get $LOOP_PROCESS_STATE)) (i32.const 2)))
  (func $loop_generic_copy_emit_set (param $flag i32)
    (local $state i32)
    (local.set $state (i32.atomic.load (global.get $LOOP_PROCESS_STATE)))
    (i32.atomic.store (global.get $LOOP_PROCESS_STATE)
      (if (result i32) (local.get $flag)
        (then (i32.or (local.get $state) (i32.const 2)))
        (else (i32.and (local.get $state) (i32.const 0xfffffffd))))))
  ;; Exact six-op AoE grid-fill lowering. Independently switchable for
  ;; same-process semantic and timing A/Bs; the production default is on.
  (global $loop_aoe_fill_emit_enabled (mut i32) (i32.const 1))
  (global $loop_aoe_span_emit_enabled (mut i32) (i32.const 1))
  ;; Jazz 2 has three copies of one exact two-block masked MMX row loop. Keep
  ;; its gate and the two semantically identical store strategies separate
  ;; from the older scalar COPY_RUN gate: the benchmark can switch the latter
  ;; at runtime after one decoded H419 stream has been cached.
  (global $mmx_mask_copy_enabled (mut i32) (i32.const 1))
  ;; In larger same-process alternating runs, two v128 stores beat the bulk arm
  ;; by 22-32% for this exact 32-byte row: memory.copy rereads bytes already
  ;; loaded to preserve MMX state. Keep the measured winner as the default.
  (global $mmx_mask_copy_use_bulk (mut i32) (i32.const 0))
  (global $mmx_mask_copy_matches (mut i32) (i32.const 0))
  (global $mmx_mask_copy_runs (mut i32) (i32.const 0))
  (global $mmx_mask_copy_rows (mut i64) (i64.const 0))
  (global $mmx_mask_copy_bytes (mut i64) (i64.const 0))

  ;; Decode-time FNV-1a over guest bytes. Exact binary-specific folds use this
  ;; after cheap anchor checks so accepting a fold proves the complete body,
  ;; not just a handful of instruction words sampled from it.
  (func $loop_hash_bytes (param $start i32) (param $length i32) (result i32)
    (local $p i32) (local $end i32) (local $hash i32)
    (local.set $p (local.get $start))
    (local.set $end (i32.add (local.get $start) (local.get $length)))
    (local.set $hash (i32.const 0x811C9DC5))
    (block $done
      (loop $bytes
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $hash
          (i32.mul
            (i32.xor (local.get $hash) (call $gl8 (local.get $p)))
            (i32.const 0x01000193)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $bytes)))
    (local.get $hash))

  ;; Recognize the exact Jazz row-mask loop at 0x468892/0x468a04/0x468b7e.
  ;; This is deliberately a raw-byte proof rather than an extension of the
  ;; self-loop matcher: JAE splits the idiom into a mask head and a copy/tail
  ;; block, while Design A only sees one self-loop block at a time. A near miss
  ;; falls through to the ordinary decoder without consuming a byte.
  (func $try_emit_mmx_mask_copy32 (param $start_eip i32) (result i32)
    (if (i32.or (i32.eqz (global.get $mmx_mask_copy_enabled))
                (global.get $code16))
      (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (local.get $start_eip)) (i32.const 0x1E73DB03))
      (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 4)))
                (i32.const 0x0F066F0F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 8)))
                (i32.const 0x0F084E6F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 12)))
                (i32.const 0x0F10566F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 16)))
                (i32.const 0x0F185E6F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 20)))
                (i32.const 0x7F0F077F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 24)))
                (i32.const 0x7F0F084F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 28)))
                (i32.const 0x7F0F1057)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 32)))
                (i32.const 0xF803185F)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 36)))
                (i32.const 0x4A20C683)) (then (return (i32.const 0))))
    (if (i32.ne (call $gl16 (i32.add (local.get $start_eip) (i32.const 40)))
                (i32.const 0xD675)) (then (return (i32.const 0))))

    (global.set $mmx_mask_copy_matches
      (i32.add (global.get $mmx_mask_copy_matches) (i32.const 1)))
    ;; Reuse H419's otherwise-zero operand namespace. The high bit selects the
    ;; fixed masked-MMX descriptor; the normal scalar COPY_RUN remains op=0.
    (call $te (global.get $LOOP_SUPEROP_COPY) (i32.const 0x80000000))
    (call $te_raw (i32.add (local.get $start_eip) (i32.const 42)))
    (call $te_raw (local.get $start_eip))
    (global.set $d_pc (i32.add (local.get $start_eip) (i32.const 42)))
    (i32.const 1))

  ;; AoE I and II use the same span-list data structure and clipping algorithm,
  ;; but their MSVC builds assigned x/min/max registers differently and only
  ;; AoE I scales the row register before lookup. Recognize either exact prefix
  ;; and pass that register-layout mode to one parameterized handler. All exits
  ;; are entry-relative, so no binary address lives in core.
  (func $try_emit_aoe_span_prefix (param $start_eip i32) (result i32)
    (local $mode i32)
    (if (i32.or
          (i32.eqz (global.get $loop_aoe_span_emit_enabled))
          (global.get $code16))
      (then (return (i32.const 0))))
    ;; Shared push/mov/prologue bytes.
    (if (i32.or
          (i32.ne (call $gl32 (local.get $start_eip)) (i32.const 0x8B565553))
          (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 4)))
                  (i32.const 0x7C8B57F1)))
      (then (return (i32.const 0))))

    ;; Mode 1: AoE I, EAX=x0 and EDI=row*4.
    (if (i32.and
          (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x20)))
                  (i32.const 0x1424448B))
          (i32.and
            (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x50)))
                    (i32.const 0x14244C89))
            (i32.and
              (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x5e)))
                      (i32.const 0xC13C468B))
              (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x67)))
                      (i32.const 0x3C75DB85)))))
      (then (local.set $mode (i32.const 1))))

    ;; Mode 2: AoE II, EBX=x0 and EDI=row.
    (if (i32.and
          (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x20)))
                  (i32.const 0x18246C8B))
          (i32.and
            (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x50)))
                    (i32.const 0x14244489))
            (i32.and
              (i32.eq (call $gl32 (i32.add (local.get $start_eip) (i32.const 0x60)))
                      (i32.const 0x8B3C468B))
              (i32.eq (call $gl16 (i32.add (local.get $start_eip) (i32.const 0x67)))
                      (i32.const 0x75C0)))))
      (then (local.set $mode (i32.const 2))))
    (if (i32.eqz (local.get $mode)) (then (return (i32.const 0))))

    ;; The anchors above select the register-layout variant cheaply; the hash
    ;; proves every byte of the complete replaced prefix. These are the FNV-1a
    ;; digests of the 0x6b-byte AoE I and 0x6a-byte AoE II retail bodies used by
    ;; the differential regression below.
    (if (i32.ne
          (call $loop_hash_bytes (local.get $start_eip)
            (select (i32.const 0x6b) (i32.const 0x6a)
              (i32.eq (local.get $mode) (i32.const 1))))
          (select (i32.const 0x99364898) (i32.const 0xe76d1b61)
            (i32.eq (local.get $mode) (i32.const 1))))
      (then (return (i32.const 0))))

    (global.set $loop_aoe_span_matches
      (i32.add (global.get $loop_aoe_span_matches) (i32.const 1)))
    (call $te (i32.const 438) (local.get $mode))
    (call $te_raw (local.get $start_eip))
    (global.set $d_pc
      (i32.add (local.get $start_eip)
        (select (i32.const 0x6b) (i32.const 0x6a)
          (i32.eq (local.get $mode) (i32.const 1)))))
    (i32.const 1))

  ;; A branch-split 8-bit color-key row used by Alpha Centauri's FLC/menu
  ;; compositor. The conditional store keeps it outside the self-loop matcher:
  ;;
  ;;   cmp byte [edi],ah; jne +2; mov [edi],al; inc edi; dec esi; jne head
  ;;
  ;; Match the complete encoding, but derive both continuations from the block
  ;; address. Another binary emitting these ten bytes gets the same semantics.
  (func $try_emit_colorkey8_run (param $start_eip i32) (result i32)
    (if (global.get $code16) (then (return (i32.const 0))))
    (if (i32.or
          (i32.ne (call $gl32 (local.get $start_eip)) (i32.const 0x02752738))
          (i32.or
            (i32.ne (call $gl32 (i32.add (local.get $start_eip) (i32.const 4)))
              (i32.const 0x4e470788))
            (i32.ne (call $gl16 (i32.add (local.get $start_eip) (i32.const 8)))
              (i32.const 0xf675))))
      (then (return (i32.const 0))))
    (global.set $loop_colorkey8_matches
      (i32.add (global.get $loop_colorkey8_matches) (i32.const 1)))
    (call $te (i32.const 443) (i32.const 0))
    (call $te_raw (i32.add (local.get $start_eip) (i32.const 10))) ;; fall
    (call $te_raw (local.get $start_eip))                          ;; restart
    (global.set $d_pc (i32.add (local.get $start_eip) (i32.const 10)))
    (i32.const 1))

  ;; Is this handler index a conditional branch? 44 is the generic form
  ;; (operand = cc); 307..322 are the per-condition specializations. All read
  ;; the same two extra words: fall-through, then target.
  (func $loop_is_jcc (param $fn i32) (result i32)
    (i32.or
      (i32.eq (local.get $fn) (i32.const 44))
      (i32.and
        (i32.ge_u (local.get $fn) (i32.const 307))
        (i32.le_u (local.get $fn) (i32.const 322)))))

  ;; Classify one handler index. Everything not named here is UNKNOWN.
  (func $loop_role (param $fn i32) (param $op i32) (result i32)
    (if (i32.eq (local.get $fn) (i32.const 28))
      (then (return (global.get $LR_LOAD8))))
    ;; 149 computes a SIB effective address. With bit 8 of the operand set it
    ;; also performs the byte load itself -- the fused form the decoder emits
    ;; for the overwhelmingly common consumer, and the one a LUT lookup takes.
    ;; Without bit 8 the load lives in the NEXT op, which this matcher does not
    ;; model, so decline.
    (if (i32.eq (local.get $fn) (i32.const 149))
      (then
        (if (i32.and (local.get $op) (i32.const 0x100))
          (then (return (global.get $LR_LOAD8S))))
        (return (global.get $LR_UNKNOWN))))
    (if (i32.eq (local.get $fn) (i32.const 29))
      (then (return (global.get $LR_STORE8))))
    (if (i32.or (i32.eq (local.get $fn) (i32.const 64))
                (i32.eq (local.get $fn) (i32.const 65)))
      (then (return (global.get $LR_ADDI))))
    (if (i32.eq (local.get $fn) (i32.const 19))
      (then (return (global.get $LR_CMP))))
    (if (i32.eq (local.get $fn) (i32.const 53))
      (then (return (global.get $LR_SHIFT))))
    (if (i32.eq (local.get $fn) (i32.const 12))
      (then (return (global.get $LR_ADD))))
    ;; xor r,r and sub r,r are the zeroing idiom, not arithmetic (design 9.5),
    ;; but only when both operands name the same register.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 18))
                (i32.eq (local.get $fn) (i32.const 17)))
      (then
        (if (i32.eq (i32.shr_u (local.get $op) (i32.const 4))
                    (i32.and (local.get $op) (i32.const 0xF)))
          (then (return (global.get $LR_ZERO))))
        (return (global.get $LR_UNKNOWN))))
    ;; STORE32 to an absolute address -- the spill-to-global "mirror" store.
    (if (i32.eq (local.get $fn) (i32.const 21))
      (then (return (global.get $LR_MIRROR))))
    ;; 135 is inc/dec/not/neg of a dword in memory; only the two counting forms
    ;; (uop 0 = inc, 1 = dec) are a role. A trip counter that lives on the
    ;; stack instead of in a register is the normal shape once a loop body has
    ;; run out of registers, which is exactly when the body is worth lowering.
    (if (i32.eq (local.get $fn) (i32.const 135))
      (then
        (if (i32.le_u (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
                      (i32.const 1))
          (then (return (global.get $LR_MEMCTR))))
        (return (global.get $LR_UNKNOWN))))
    (if (call $loop_is_jcc (local.get $fn))
      (then (return (global.get $LR_JCC))))
    (global.get $LR_UNKNOWN))

  ;; One threaded-code op, as $te writes it (04-cache.wat :: $te). size-of is 8,
  ;; which is exactly the bump $te makes after storing the pair — an op's header
  ;; is two words and nothing else is guaranteed to follow it.
  ;;
  ;; ONLY the header is a layout, deliberately, and the rest of the record is
  ;; not a struct at all. Handlers pull extra words with $te_raw, and both the
  ;; arity and the meaning are chosen by the handler index at +0:
  ;;
  ;;   +8 is the fall-through EIP for Jcc (fn 307..322, 07-decoder.wat:4257)
  ;;      but the branch TARGET for LOOP (fn 46, 07-decoder.wat:4270, read at
  ;;      05-alu.wat:929) — the same offset with the pair in the opposite order;
  ;;   +8 is a packed base|index<<4|scale<<8 SIB info word for fn 149/363/389/420
  ;;      ($sib_info_word, 07-decoder.wat:1522; read 06b-core-handlers.wat:281),
  ;;      a plain disp32 for the _ro family (06b-core-handlers.wat:1589), and a
  ;;      raw absolute address or $SIB_SENTINEL for fn 20/21 (05-alu.wat:386);
  ;;   fn 407 puts fall/target at +16/+20 instead (07-decoder.wat:1782), and the
  ;;      payload arity runs 0,1,2,3,4,6,7 words with no length field and at
  ;;      least three conditional-arity emitters (07-decoder.wat:2094, 1957, 562).
  ;;
  ;; That is why OP_INDEX exists at all: the stream is not self-describing, so
  ;; nothing can walk it structurally (04-cache.wat:876). Every +8 read in this
  ;; file is already guarded by an equality test on the handler index just above
  ;; it, and 07-decoder.wat:5305 documents what happens to code that infers the
  ;; shape positionally instead. So the trailing words are a discriminated union
  ;; keyed by `handler` — §5.4's variant shape — but with a computed tag rather
  ;; than a stored type word, which is also why wave 5's variant gate cannot
  ;; attribute them. They stay hand-spelled until a variant declaration can name
  ;; each arm from evidence; --gate leaves them alone because an undeclared
  ;; offset is not a convertible site.
  (layout LoopOp
    (field handler i32)    ;; +0  handler-table index; $te's $fn, $loop_is_jcc's arg
    (field operand i32))   ;; +4  packed operand; $te's $op, masked 0xF for regs

  ;; Address of op i in the block just emitted.
  (func $loop_op_at (param $i i32) (result i32)
    (i32.load
      (i32.add (global.get $OP_INDEX)
        (i32.shl (local.get $i) (i32.const 2)))))

  ;; Normalize H188/H190 into group|operation|address-shape fields. The low
  ;; nibble is a base register, or 8 for a decoder-resolved absolute address.
  ;; A SIB_SENTINEL depends on a separate preceding EA handler and therefore
  ;; cannot be part of this first contiguous semantic family.
  (func $x87_mem_desc (param $p i32) (result i32)
    (local $fn i32) (local $op i32)
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.eq (local.get $fn) (i32.const 190))
      (then (return (i32.and (local.get $op) (i32.const 0xFFF)))))
    (if (i32.eq (local.get $fn) (i32.const 188))
      (then
        (if (i32.eq (i32.load offset=8 (local.get $p)) (global.get $SIB_SENTINEL))
          (then (return (i32.const -1))))
        (return
          (i32.or
            (i32.shl (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 8))
            (i32.or
              (i32.shl (i32.and (local.get $op) (i32.const 0xF)) (i32.const 4))
              (i32.const 8))))))
    (i32.const -1))

  (func $x87_pipeline_arith_op (param $desc i32) (result i32)
    (local $group i32) (local $op i32)
    (local.set $group (i32.and (i32.shr_u (local.get $desc) (i32.const 8)) (i32.const 0xF)))
    (local.set $op (i32.and (i32.shr_u (local.get $desc) (i32.const 4)) (i32.const 0xF)))
    (if (i32.and
          (i32.or (i32.eqz (local.get $group)) (i32.eq (local.get $group) (i32.const 4)))
          (i32.or
            (i32.or (i32.eqz (local.get $op)) (i32.eq (local.get $op) (i32.const 1)))
            (i32.ge_u (local.get $op) (i32.const 4))))
      (then (return (local.get $op))))
    (i32.const -1))

  (func $x87_pipeline_load_desc (param $desc i32) (result i32)
    (i32.and
      (i32.or
        (i32.eq (i32.shr_u (local.get $desc) (i32.const 8)) (i32.const 1))
        (i32.eq (i32.shr_u (local.get $desc) (i32.const 8)) (i32.const 5)))
      (i32.eq
        (i32.and (i32.shr_u (local.get $desc) (i32.const 4)) (i32.const 0xF))
        (i32.const 0))))

  (func $x87_pipeline_storepop_desc (param $desc i32) (result i32)
    (i32.and
      (i32.or
        (i32.eq (i32.shr_u (local.get $desc) (i32.const 8)) (i32.const 1))
        (i32.eq (i32.shr_u (local.get $desc) (i32.const 8)) (i32.const 5)))
      (i32.eq
        (i32.and (i32.shr_u (local.get $desc) (i32.const 4)) (i32.const 0xF))
        (i32.const 3))))

  ;; Replace every proven contiguous
  ;;
  ;;   FLD mem; FADD/FMUL/FSUB/FDIV mem; same; FSTP mem
  ;;
  ;; with one semantic handler. The original 48-byte threaded payload remains
  ;; in place; only its first handler/operand are rewritten, so no later op
  ;; address or block ownership changes. The fused handler consumes the four
  ;; raw address words and advances directly to the following op.
  (func $x87_fuse_block
    (local $i i32) (local $n i32)
    (local $p0 i32) (local $p1 i32) (local $p2 i32) (local $p3 i32)
    (local $d0 i32) (local $d1 i32) (local $d2 i32) (local $d3 i32)
    (local $a1 i32) (local $a2 i32) (local $packed i32)
    (if (global.get $op_index_poison) (then (return)))
    (local.set $n (global.get $op_index_n))
    (block $done (loop $scan
      (br_if $done (i32.gt_u (i32.add (local.get $i) (i32.const 4)) (local.get $n)))
      (local.set $p0 (call $loop_op_at (local.get $i)))
      (local.set $p1 (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
      (local.set $p2 (call $loop_op_at (i32.add (local.get $i) (i32.const 2))))
      (local.set $p3 (call $loop_op_at (i32.add (local.get $i) (i32.const 3))))
      (if (i32.and
            (i32.eq (local.get $p1) (i32.add (local.get $p0) (i32.const 12)))
            (i32.and
              (i32.eq (local.get $p2) (i32.add (local.get $p1) (i32.const 12)))
              (i32.eq (local.get $p3) (i32.add (local.get $p2) (i32.const 12)))))
        (then
          (local.set $d0 (call $x87_mem_desc (local.get $p0)))
          (local.set $d1 (call $x87_mem_desc (local.get $p1)))
          (local.set $d2 (call $x87_mem_desc (local.get $p2)))
          (local.set $d3 (call $x87_mem_desc (local.get $p3)))
          (local.set $a1 (call $x87_pipeline_arith_op (local.get $d1)))
          (local.set $a2 (call $x87_pipeline_arith_op (local.get $d2)))
          (if (i32.and
                (i32.and
                  (i32.or
                    (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 1))
                    (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5)))
                  (i32.eq (i32.and (i32.shr_u (local.get $d0) (i32.const 4)) (i32.const 0xF)) (i32.const 0)))
                (i32.and
                  (i32.and (i32.ge_s (local.get $a1) (i32.const 0))
                           (i32.ge_s (local.get $a2) (i32.const 0)))
                  (i32.and
                    (i32.or
                      (i32.eq (i32.shr_u (local.get $d3) (i32.const 8)) (i32.const 1))
                      (i32.eq (i32.shr_u (local.get $d3) (i32.const 8)) (i32.const 5)))
                    (i32.eq (i32.and (i32.shr_u (local.get $d3) (i32.const 4)) (i32.const 0xF)) (i32.const 3)))))
            (then
              (global.set $x87_pipeline4_matches
                (i32.add (global.get $x87_pipeline4_matches) (i32.const 1)))
              (if (global.get $x87_pipeline4_emit_enabled)
                (then
                  (local.set $packed
                    (i32.or
                      (i32.and (local.get $d0) (i32.const 0xF))
                      (i32.or
                        (i32.shl (i32.and (local.get $d1) (i32.const 0xF)) (i32.const 4))
                        (i32.or
                          (i32.shl (i32.and (local.get $d2) (i32.const 0xF)) (i32.const 8))
                          (i32.or
                            (i32.shl (i32.and (local.get $d3) (i32.const 0xF)) (i32.const 12))
                            (i32.or
                              (i32.shl (local.get $a1) (i32.const 16))
                              (i32.or
                                (i32.shl (local.get $a2) (i32.const 19))
                                (i32.or
                                  (i32.shl
                                    (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5))
                                    (i32.const 22))
                                  (i32.or
                                    (i32.shl
                                      (i32.eq (i32.shr_u (local.get $d1) (i32.const 8)) (i32.const 4))
                                      (i32.const 23))
                                    (i32.or
                                      (i32.shl
                                        (i32.eq (i32.shr_u (local.get $d2) (i32.const 8)) (i32.const 4))
                                        (i32.const 24))
                                      (i32.shl
                                        (i32.eq (i32.shr_u (local.get $d3) (i32.const 8)) (i32.const 5))
                                        (i32.const 25))))))))))))
                  (store.field LoopOp handler (local.get $p0) (i32.const 449))
                  (store.field.memarg LoopOp operand (local.get $p0) (local.get $packed))
                  (local.set $i (i32.add (local.get $i) (i32.const 4)))
                  (br $scan)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan))))

  ;; The same straight-line emitter also covers the common shorter semantic
  ;; regions found by the corpus census:
  ;;
  ;;   FLD mem; FSTP mem
  ;;   FLD mem; arithmetic mem; FSTP mem
  ;;   FLD mem; FCHS|FABS; FSTP mem
  ;;
  ;; Bits 26..27 select 2-op copy, 3-op memory arithmetic, or 3-op unary.
  ;; The descriptor keeps address and width parameters, so these are semantic
  ;; families rather than instruction-byte templates.
  (func $x87_short_fuse_block
    (local $i i32) (local $n i32) (local $p0 i32) (local $p1 i32) (local $p2 i32)
    (local $d0 i32) (local $d1 i32) (local $d2 i32)
    (local $a1 i32) (local $rop i32) (local $packed i32)
    (if (global.get $op_index_poison) (then (return)))
    (local.set $n (global.get $op_index_n))
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $p0 (call $loop_op_at (local.get $i)))
      (local.set $d0 (call $x87_mem_desc (local.get $p0)))
      (if (call $x87_pipeline_load_desc (local.get $d0))
        (then
          ;; Prefer a three-op region before considering the two-op copy.
          (if (i32.le_u (i32.add (local.get $i) (i32.const 3)) (local.get $n))
            (then
              (local.set $p1 (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
              (local.set $p2 (call $loop_op_at (i32.add (local.get $i) (i32.const 2))))
              (local.set $d2 (call $x87_mem_desc (local.get $p2)))
              (if (call $x87_pipeline_storepop_desc (local.get $d2))
                (then
                  ;; Memory arithmetic: every record is 12 bytes.
                  (if (i32.and
                        (i32.eq (local.get $p1) (i32.add (local.get $p0) (i32.const 12)))
                        (i32.eq (local.get $p2) (i32.add (local.get $p1) (i32.const 12))))
                    (then
                      (local.set $d1 (call $x87_mem_desc (local.get $p1)))
                      (local.set $a1 (call $x87_pipeline_arith_op (local.get $d1)))
                      (if (i32.ge_s (local.get $a1) (i32.const 0))
                        (then
                          (local.set $packed (i32.and (local.get $d0) (i32.const 0xF)))
                          (local.set $packed (i32.or (local.get $packed)
                            (i32.shl (i32.and (local.get $d1) (i32.const 0xF)) (i32.const 4))))
                          (local.set $packed (i32.or (local.get $packed)
                            (i32.shl (i32.and (local.get $d2) (i32.const 0xF)) (i32.const 12))))
                          (local.set $packed (i32.or (local.get $packed)
                            (i32.shl (local.get $a1) (i32.const 16))))
                          (local.set $packed (i32.or (local.get $packed)
                            (i32.shl (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5)) (i32.const 22))))
                          (local.set $packed (i32.or (local.get $packed)
                            (i32.shl (i32.eq (i32.shr_u (local.get $d1) (i32.const 8)) (i32.const 4)) (i32.const 23))))
                          (local.set $packed (i32.or (local.get $packed)
                            (i32.shl (i32.eq (i32.shr_u (local.get $d2) (i32.const 8)) (i32.const 5)) (i32.const 25))))
                          (local.set $packed (i32.or (local.get $packed) (i32.shl (i32.const 1) (i32.const 26))))
                          (global.set $x87_pipeline4_matches
                            (i32.add (global.get $x87_pipeline4_matches) (i32.const 1)))
                          (if (global.get $x87_pipeline4_emit_enabled)
                            (then
                              (store.field LoopOp handler (local.get $p0) (i32.const 449))
                              (store.field.memarg LoopOp operand (local.get $p0) (local.get $packed))))
                          (local.set $i (i32.add (local.get $i) (i32.const 3)))
                          (br $scan)))))
                  ;; Unary register op: D9 E0/E1, and an 8-byte middle record.
                  (local.set $rop (load.field.memarg LoopOp operand (local.get $p1)))
                  (if (i32.and
                        (i32.and
                          (i32.eq (local.get $p1) (i32.add (local.get $p0) (i32.const 12)))
                          (i32.eq (local.get $p2) (i32.add (local.get $p1) (i32.const 8))))
                        (i32.and
                          (i32.eq (load.field LoopOp handler (local.get $p1)) (i32.const 189))
                          (i32.or (i32.eq (local.get $rop) (i32.const 0x140))
                                  (i32.eq (local.get $rop) (i32.const 0x141)))))
                    (then
                      (local.set $packed (i32.and (local.get $d0) (i32.const 0xF)))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.and (local.get $d2) (i32.const 0xF)) (i32.const 12))))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.and (local.get $rop) (i32.const 1)) (i32.const 16))))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5)) (i32.const 22))))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.eq (i32.shr_u (local.get $d2) (i32.const 8)) (i32.const 5)) (i32.const 25))))
                      (local.set $packed (i32.or (local.get $packed) (i32.shl (i32.const 3) (i32.const 26))))
                      (global.set $x87_pipeline4_matches
                        (i32.add (global.get $x87_pipeline4_matches) (i32.const 1)))
                      (if (global.get $x87_pipeline4_emit_enabled)
                        (then
                          (store.field LoopOp handler (local.get $p0) (i32.const 449))
                          (store.field.memarg LoopOp operand (local.get $p0) (local.get $packed))))
                      (local.set $i (i32.add (local.get $i) (i32.const 3)))
                      (br $scan)))))))
          ;; Two memory records: a typed load/store conversion or exact copy.
          (if (i32.le_u (i32.add (local.get $i) (i32.const 2)) (local.get $n))
            (then
              (local.set $p1 (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
              (if (i32.eq (local.get $p1) (i32.add (local.get $p0) (i32.const 12)))
                (then
                  (local.set $d1 (call $x87_mem_desc (local.get $p1)))
                  (if (call $x87_pipeline_storepop_desc (local.get $d1))
                    (then
                      (local.set $packed (i32.and (local.get $d0) (i32.const 0xF)))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.and (local.get $d1) (i32.const 0xF)) (i32.const 12))))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5)) (i32.const 22))))
                      (local.set $packed (i32.or (local.get $packed)
                        (i32.shl (i32.eq (i32.shr_u (local.get $d1) (i32.const 8)) (i32.const 5)) (i32.const 25))))
                      (local.set $packed (i32.or (local.get $packed) (i32.shl (i32.const 2) (i32.const 26))))
                      (global.set $x87_pipeline4_matches
                        (i32.add (global.get $x87_pipeline4_matches) (i32.const 1)))
                      (if (global.get $x87_pipeline4_emit_enabled)
                        (then
                          (store.field LoopOp handler (local.get $p0) (i32.const 449))
                          (store.field.memarg LoopOp operand (local.get $p0) (local.get $packed))))
                      (local.set $i (i32.add (local.get $i) (i32.const 2)))
                      (br $scan)))))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan))))

  (func $x87_pipeline_addr (param $base i32) (param $word i32) (result i32)
    (if (result i32) (i32.eq (local.get $base) (i32.const 8))
      (then (local.get $word))
      (else (i32.add (call $get_reg (local.get $base)) (local.get $word)))))

  (func $x87_pipeline_load (param $addr i32) (param $wide i32) (result f64)
    (if (result f64) (local.get $wide)
      (then (f64.load (call $g2w (local.get $addr))))
      (else (f64.promote_f32 (f32.load (call $g2w (local.get $addr)))))))

  ;; 449: a bounded straight-line expression pipeline. Mode 0 is the original
  ;; four-op/two-arithmetic form; modes 1/2/3 are memory-arithmetic, copy, and
  ;; unary three-op regions. Preserve source evaluation order and use
  ;; $fpu_arith so divide-by-zero/status behavior remains canonical.
  (func $th_x87_pipeline4 (param $op i32)
    (local $tp i32) (local $a0 i32) (local $a1 i32)
    (local $a2 i32) (local $a3 i32) (local $wa i32) (local $mode i32)
    (local $v f64) (local $rhs f64)
    (local.set $tp (global.get $ip))
    (local.set $mode (i32.and (i32.shr_u (local.get $op) (i32.const 26)) (i32.const 3)))
    ;; Each original memory op is a normal 8-byte handler record plus one raw
    ;; address/displacement word. $ip initially points at the first raw word.
    (local.set $a0
      (call $x87_pipeline_addr
        (i32.and (local.get $op) (i32.const 0xF))
        (i32.load (local.get $tp))))
    (if (i32.eqz (local.get $mode))
      (then
        (local.set $a1 (call $x87_pipeline_addr
          (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
          (i32.load offset=12 (local.get $tp))))
        (local.set $a2 (call $x87_pipeline_addr
          (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xF))
          (i32.load offset=24 (local.get $tp))))
        (local.set $a3 (call $x87_pipeline_addr
          (i32.and (i32.shr_u (local.get $op) (i32.const 12)) (i32.const 0xF))
          (i32.load offset=36 (local.get $tp))))
        (global.set $ip (i32.add (local.get $tp) (i32.const 40))))
      (else (if (i32.eq (local.get $mode) (i32.const 1))
        (then
          (local.set $a1 (call $x87_pipeline_addr
            (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
            (i32.load offset=12 (local.get $tp))))
          (local.set $a3 (call $x87_pipeline_addr
            (i32.and (i32.shr_u (local.get $op) (i32.const 12)) (i32.const 0xF))
            (i32.load offset=24 (local.get $tp))))
          (global.set $ip (i32.add (local.get $tp) (i32.const 28))))
        (else (if (i32.eq (local.get $mode) (i32.const 2))
          (then
            (local.set $a3 (call $x87_pipeline_addr
              (i32.and (i32.shr_u (local.get $op) (i32.const 12)) (i32.const 0xF))
              (i32.load offset=12 (local.get $tp))))
            (global.set $ip (i32.add (local.get $tp) (i32.const 16))))
          (else
            (local.set $a3 (call $x87_pipeline_addr
              (i32.and (i32.shr_u (local.get $op) (i32.const 12)) (i32.const 0xF))
              (i32.load offset=20 (local.get $tp))))
            (global.set $ip (i32.add (local.get $tp) (i32.const 24)))))))))

    ;; FLD reads memory before it mutates TOP. Delay materializing ST(0) until
    ;; the final store: no instruction inside this proven region observes it.
    (local.set $v
      (call $x87_pipeline_load (local.get $a0)
        (i32.and (i32.shr_u (local.get $op) (i32.const 22)) (i32.const 1))))
    (global.set $fpu_top
      (i32.and (i32.sub (global.get $fpu_top) (i32.const 1)) (i32.const 7)))
    (if (call $fpu_is_valid (i32.const 0))
      (then (call $fpu_set_exc (i32.const 0x41))))

    (if (i32.le_u (local.get $mode) (i32.const 1))
      (then
        (local.set $rhs
          (call $x87_pipeline_load (local.get $a1)
            (i32.and (i32.shr_u (local.get $op) (i32.const 23)) (i32.const 1))))
        (local.set $v
          (call $fpu_arith (local.get $v) (local.get $rhs)
            (i32.and (i32.shr_u (local.get $op) (i32.const 16)) (i32.const 7))))))
    (if (i32.eqz (local.get $mode))
      (then
        (local.set $rhs
          (call $x87_pipeline_load (local.get $a2)
            (i32.and (i32.shr_u (local.get $op) (i32.const 24)) (i32.const 1))))
        (local.set $v
          (call $fpu_arith (local.get $v) (local.get $rhs)
            (i32.and (i32.shr_u (local.get $op) (i32.const 19)) (i32.const 7))))))
    (if (i32.eq (local.get $mode) (i32.const 3))
      (then
        (if (i32.eqz (i32.and (i32.shr_u (local.get $op) (i32.const 16)) (i32.const 1)))
          (then (local.set $v (f64.neg (local.get $v))))
          (else (local.set $v (f64.abs (local.get $v)))))))

    ;; Evaluate the output translation before FSTP mutates the stack, exactly
    ;; like the scalar store handler's Wasm operand evaluation order.
    (local.set $wa (call $g2w (local.get $a3)))
    (call $fpu_set (i32.const 0) (local.get $v))
    (if (i32.and (i32.shr_u (local.get $op) (i32.const 25)) (i32.const 1))
      (then (f64.store (local.get $wa) (call $fpu_pop)))
      (else (f32.store (local.get $wa) (f32.demote_f64 (call $fpu_pop)))))
    (global.set $x87_pipeline4_runs
      (i32.add (global.get $x87_pipeline4_runs) (i32.const 1)))
    (return_call $next))

  ;; Recognize the balanced binary-tree leaf used by Alpha's TQI algebra and
  ;; by ordinary compiler output generally:
  ;;
  ;;   FLD a; FLD b; FADDP/FMULP/FSUBP/FDIVP ST(1),ST(0); FSTP d
  ;;
  ;; Both inputs and the output may independently be f32/f64 and absolute or
  ;; simple-base addressed. rm must be ST(1): larger indices consume preexisting
  ;; stack state and are not a closed expression tree.
  (func $x87_tree4_fuse_block
    (local $i i32) (local $n i32)
    (local $p0 i32) (local $p1 i32) (local $p2 i32) (local $p3 i32)
    (local $d0 i32) (local $d1 i32) (local $d3 i32)
    (local $rop i32) (local $arith i32) (local $packed i32)
    (if (global.get $op_index_poison) (then (return)))
    (local.set $n (global.get $op_index_n))
    (block $done (loop $scan
      (br_if $done (i32.gt_u (i32.add (local.get $i) (i32.const 4)) (local.get $n)))
      (local.set $p0 (call $loop_op_at (local.get $i)))
      (local.set $p1 (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
      (local.set $p2 (call $loop_op_at (i32.add (local.get $i) (i32.const 2))))
      (local.set $p3 (call $loop_op_at (i32.add (local.get $i) (i32.const 3))))
      (if (i32.and
            (i32.eq (local.get $p1) (i32.add (local.get $p0) (i32.const 12)))
            (i32.and
              (i32.eq (local.get $p2) (i32.add (local.get $p1) (i32.const 12)))
              (i32.eq (local.get $p3) (i32.add (local.get $p2) (i32.const 8)))))
        (then
          (local.set $d0 (call $x87_mem_desc (local.get $p0)))
          (local.set $d1 (call $x87_mem_desc (local.get $p1)))
          (local.set $d3 (call $x87_mem_desc (local.get $p3)))
          (local.set $rop (load.field.memarg LoopOp operand (local.get $p2)))
          (local.set $arith
            (i32.and (i32.shr_u (local.get $rop) (i32.const 4)) (i32.const 0xF)))
          (if (i32.and
                (i32.and
                  (i32.and
                    (i32.or
                      (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 1))
                      (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5)))
                    (i32.eq (i32.and (i32.shr_u (local.get $d0) (i32.const 4)) (i32.const 0xF)) (i32.const 0)))
                  (i32.and
                    (i32.or
                      (i32.eq (i32.shr_u (local.get $d1) (i32.const 8)) (i32.const 1))
                      (i32.eq (i32.shr_u (local.get $d1) (i32.const 8)) (i32.const 5)))
                    (i32.eq (i32.and (i32.shr_u (local.get $d1) (i32.const 4)) (i32.const 0xF)) (i32.const 0))))
                (i32.and
                  (i32.and
                    (i32.eq (load.field LoopOp handler (local.get $p2)) (i32.const 189))
                    (i32.and
                      (i32.eq (i32.shr_u (local.get $rop) (i32.const 8)) (i32.const 6))
                      (i32.eq (i32.and (local.get $rop) (i32.const 0xF)) (i32.const 1))))
                  (i32.and
                    (i32.or
                      (i32.or (i32.eqz (local.get $arith)) (i32.eq (local.get $arith) (i32.const 1)))
                      (i32.ge_u (local.get $arith) (i32.const 4)))
                    (i32.and
                      (i32.or
                        (i32.eq (i32.shr_u (local.get $d3) (i32.const 8)) (i32.const 1))
                        (i32.eq (i32.shr_u (local.get $d3) (i32.const 8)) (i32.const 5)))
                      (i32.eq (i32.and (i32.shr_u (local.get $d3) (i32.const 4)) (i32.const 0xF)) (i32.const 3))))))
            (then
              (global.set $x87_tree4_matches
                (i32.add (global.get $x87_tree4_matches) (i32.const 1)))
              (if (global.get $x87_pipeline4_emit_enabled)
                (then
                  (local.set $packed
                    (i32.or
                      (i32.and (local.get $d0) (i32.const 0xF))
                      (i32.or
                        (i32.shl (i32.and (local.get $d1) (i32.const 0xF)) (i32.const 4))
                        (i32.or
                          (i32.shl (i32.and (local.get $d3) (i32.const 0xF)) (i32.const 8))
                          (i32.or
                            (i32.shl (local.get $arith) (i32.const 12))
                            (i32.or
                              (i32.shl
                                (i32.eq (i32.shr_u (local.get $d0) (i32.const 8)) (i32.const 5))
                                (i32.const 15))
                              (i32.or
                                (i32.shl
                                  (i32.eq (i32.shr_u (local.get $d1) (i32.const 8)) (i32.const 5))
                                  (i32.const 16))
                                (i32.shl
                                  (i32.eq (i32.shr_u (local.get $d3) (i32.const 8)) (i32.const 5))
                                  (i32.const 17)))))))))
                  (store.field LoopOp handler (local.get $p0) (i32.const 450))
                  (store.field.memarg LoopOp operand (local.get $p0) (local.get $packed))
                  (local.set $i (i32.add (local.get $i) (i32.const 4)))
                  (br $scan)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan))))

  (func $x87_tree_arith (param $older f64) (param $top f64)
                        (param $op i32) (result f64)
    (if (i32.or (i32.eqz (local.get $op)) (i32.eq (local.get $op) (i32.const 1)))
      (then (return (call $fpu_arith (local.get $older) (local.get $top) (local.get $op)))))
    (if (i32.or (i32.eq (local.get $op) (i32.const 4))
                (i32.eq (local.get $op) (i32.const 6)))
      (then (return (call $fpu_arith (local.get $top) (local.get $older) (local.get $op)))))
    ;; FSUBP/FDIVP use the older ST(1) as the left operand. Normalize their
    ;; opcode to the non-reversed $fpu_arith operation.
    (call $fpu_arith (local.get $older) (local.get $top)
      (i32.sub (local.get $op) (i32.const 1))))

  ;; 450: balanced binary expression tree leaf.
  (func $th_x87_tree4 (param $op i32)
    (local $tp i32) (local $a0 i32) (local $a1 i32) (local $a3 i32)
    (local $older f64) (local $top f64) (local $v f64) (local $wa i32)
    (local.set $tp (global.get $ip))
    (local.set $a0
      (call $x87_pipeline_addr
        (i32.and (local.get $op) (i32.const 0xF))
        (i32.load (local.get $tp))))
    (local.set $a1
      (call $x87_pipeline_addr
        (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
        (i32.load offset=12 (local.get $tp))))
    (local.set $a3
      (call $x87_pipeline_addr
        (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xF))
        (i32.load offset=32 (local.get $tp))))
    (global.set $ip (i32.add (local.get $tp) (i32.const 36)))

    ;; First FLD: read before changing TOP. Its physical payload is replaced by
    ;; the arithmetic result before exit, so it need not be materialized now.
    (local.set $older
      (call $x87_pipeline_load (local.get $a0)
        (i32.and (i32.shr_u (local.get $op) (i32.const 15)) (i32.const 1))))
    (global.set $fpu_top
      (i32.and (i32.sub (global.get $fpu_top) (i32.const 1)) (i32.const 7)))
    (if (call $fpu_is_valid (i32.const 0))
      (then (call $fpu_set_exc (i32.const 0x41))))

    ;; Second FLD's payload remains in its physical (ultimately empty) slot and
    ;; is observable through FNSAVE, so materialize it exactly once.
    (local.set $top
      (call $x87_pipeline_load (local.get $a1)
        (i32.and (i32.shr_u (local.get $op) (i32.const 16)) (i32.const 1))))
    (global.set $fpu_top
      (i32.and (i32.sub (global.get $fpu_top) (i32.const 1)) (i32.const 7)))
    (if (call $fpu_is_valid (i32.const 0))
      (then (call $fpu_set_exc (i32.const 0x41))))
    (call $fpu_set (i32.const 0) (local.get $top))

    (local.set $v
      (call $x87_tree_arith (local.get $older) (local.get $top)
        (i32.and (i32.shr_u (local.get $op) (i32.const 12)) (i32.const 7))))
    (call $fpu_set (i32.const 1) (local.get $v))
    (call $fpu_mark_empty (i32.const 0))
    (global.set $fpu_top
      (i32.and (i32.add (global.get $fpu_top) (i32.const 1)) (i32.const 7)))

    (local.set $wa (call $g2w (local.get $a3)))
    (if (i32.and (i32.shr_u (local.get $op) (i32.const 17)) (i32.const 1))
      (then (f64.store (local.get $wa) (local.get $v)))
      (else (f32.store (local.get $wa) (f32.demote_f64 (local.get $v)))))
    (call $fpu_mark_empty (i32.const 0))
    (global.set $fpu_top
      (i32.and (i32.add (global.get $fpu_top) (i32.const 1)) (i32.const 7)))
    (global.set $x87_tree4_runs
      (i32.add (global.get $x87_tree4_runs) (i32.const 1)))
    (return_call $next))

  ;; Compile the recurring two-output affine expression emitted by the Smacker
  ;; decoder. These recognizers operate on semantics plus address shape, not
  ;; absolute guest addresses. FLD ST(i) becomes a symbolic reference and FXCH
  ;; becomes a compile-time stack permutation; neither survives in H451/H452.
  (func $x87_affine_prepare_desc (param $i i32) (result i32)
    (local $p0 i32) (local $p1 i32) (local $p2 i32) (local $p3 i32)
    (local $p4 i32) (local $p5 i32) (local $p6 i32) (local $p7 i32) (local $p8 i32)
    (local $d0 i32) (local $d1 i32) (local $d3 i32) (local $d6 i32) (local $d8 i32)
    (if (i32.gt_u (i32.add (local.get $i) (i32.const 9)) (global.get $op_index_n))
      (then (return (i32.const -1))))
    (local.set $p0 (call $loop_op_at (local.get $i)))
    (local.set $p1 (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
    (local.set $p2 (call $loop_op_at (i32.add (local.get $i) (i32.const 2))))
    (local.set $p3 (call $loop_op_at (i32.add (local.get $i) (i32.const 3))))
    (local.set $p4 (call $loop_op_at (i32.add (local.get $i) (i32.const 4))))
    (local.set $p5 (call $loop_op_at (i32.add (local.get $i) (i32.const 5))))
    (local.set $p6 (call $loop_op_at (i32.add (local.get $i) (i32.const 6))))
    (local.set $p7 (call $loop_op_at (i32.add (local.get $i) (i32.const 7))))
    (local.set $p8 (call $loop_op_at (i32.add (local.get $i) (i32.const 8))))
    (if (i32.ne (local.get $p1) (i32.add (local.get $p0) (i32.const 12))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p2) (i32.add (local.get $p1) (i32.const 12))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p3) (i32.add (local.get $p2) (i32.const 8))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p4) (i32.add (local.get $p3) (i32.const 12))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p5) (i32.add (local.get $p4) (i32.const 8))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p6) (i32.add (local.get $p5) (i32.const 8))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p7) (i32.add (local.get $p6) (i32.const 12))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p8) (i32.add (local.get $p7) (i32.const 8))) (then (return (i32.const -1))))
    (local.set $d0 (call $x87_mem_desc (local.get $p0)))
    (local.set $d1 (call $x87_mem_desc (local.get $p1)))
    (local.set $d3 (call $x87_mem_desc (local.get $p3)))
    (local.set $d6 (call $x87_mem_desc (local.get $p6)))
    (local.set $d8 (call $x87_mem_desc (local.get $p8)))
    (if (i32.ne (i32.and (local.get $d0) (i32.const 0xFF0)) (i32.const 0x300)) (then (return (i32.const -1))))
    (if (i32.ne (i32.and (local.get $d1) (i32.const 0xFF0)) (i32.const 0x300)) (then (return (i32.const -1))))
    (if (i32.ne (i32.and (local.get $d3) (i32.const 0xFF0)) (i32.const 0x010)) (then (return (i32.const -1))))
    (if (i32.ne (i32.and (local.get $d6) (i32.const 0xFF0)) (i32.const 0x010)) (then (return (i32.const -1))))
    (if (i32.ne (i32.and (local.get $d8) (i32.const 0xFF0)) (i32.const 0x010)) (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p2)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p2)) (i32.const 0x100)))
      (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p4)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p4)) (i32.const 0x112)))
      (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p5)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p5)) (i32.const 0x401)))
      (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p7)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p7)) (i32.const 0x111)))
      (then (return (i32.const -1))))
    (i32.or
      (i32.and (local.get $d0) (i32.const 0xF))
      (i32.or
        (i32.shl (i32.and (local.get $d1) (i32.const 0xF)) (i32.const 4))
        (i32.or
          (i32.shl (i32.and (local.get $d3) (i32.const 0xF)) (i32.const 8))
          (i32.or
            (i32.shl (i32.and (local.get $d6) (i32.const 0xF)) (i32.const 12))
            (i32.shl (i32.and (local.get $d8) (i32.const 0xF)) (i32.const 16)))))))

  (func $x87_affine_finish_desc (param $i i32) (result i32)
    (local $p0 i32) (local $p1 i32) (local $p2 i32) (local $p3 i32) (local $p4 i32)
    (local $d2 i32) (local $d4 i32)
    (if (i32.gt_u (i32.add (local.get $i) (i32.const 5)) (global.get $op_index_n))
      (then (return (i32.const -1))))
    (local.set $p0 (call $loop_op_at (local.get $i)))
    (local.set $p1 (call $loop_op_at (i32.add (local.get $i) (i32.const 1))))
    (local.set $p2 (call $loop_op_at (i32.add (local.get $i) (i32.const 2))))
    (local.set $p3 (call $loop_op_at (i32.add (local.get $i) (i32.const 3))))
    (local.set $p4 (call $loop_op_at (i32.add (local.get $i) (i32.const 4))))
    (if (i32.ne (local.get $p1) (i32.add (local.get $p0) (i32.const 8))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p2) (i32.add (local.get $p1) (i32.const 8))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p3) (i32.add (local.get $p2) (i32.const 12))) (then (return (i32.const -1))))
    (if (i32.ne (local.get $p4) (i32.add (local.get $p3) (i32.const 8))) (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p0)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p0)) (i32.const 0x401)))
      (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p1)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p1)) (i32.const 0x652)))
      (then (return (i32.const -1))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p3)) (i32.const 189))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p3)) (i32.const 0x111)))
      (then (return (i32.const -1))))
    (local.set $d2 (call $x87_mem_desc (local.get $p2)))
    (local.set $d4 (call $x87_mem_desc (local.get $p4)))
    (if (i32.ne (i32.and (local.get $d2) (i32.const 0xFF0)) (i32.const 0x000)) (then (return (i32.const -1))))
    (if (i32.ne (i32.and (local.get $d4) (i32.const 0xFF0)) (i32.const 0x000)) (then (return (i32.const -1))))
    (i32.or
      (i32.and (local.get $d2) (i32.const 0xF))
      (i32.shl (i32.and (local.get $d4) (i32.const 0xF)) (i32.const 4))))

  (func $x87_affine_fuse_block
    (local $i i32) (local $packed i32) (local $p i32)
    (if (global.get $op_index_poison) (then (return)))
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (global.get $op_index_n)))
      (local.set $packed (call $x87_affine_prepare_desc (local.get $i)))
      (if (i32.ge_s (local.get $packed) (i32.const 0))
        (then
          (global.set $x87_affine_prepare_matches
            (i32.add (global.get $x87_affine_prepare_matches) (i32.const 1)))
          (if (global.get $x87_affine_emit_enabled)
            (then
              (local.set $p (call $loop_op_at (local.get $i)))
              (store.field LoopOp handler (local.get $p) (i32.const 452))
              (store.field.memarg LoopOp operand (local.get $p) (local.get $packed))))
          (local.set $i (i32.add (local.get $i) (i32.const 9)))
          (br $scan)))
      (local.set $packed (call $x87_affine_finish_desc (local.get $i)))
      (if (i32.ge_s (local.get $packed) (i32.const 0))
        (then
          (global.set $x87_affine_finish_matches
            (i32.add (global.get $x87_affine_finish_matches) (i32.const 1)))
          (if (global.get $x87_affine_emit_enabled)
            (then
              (local.set $p (call $loop_op_at (local.get $i)))
              (store.field LoopOp handler (local.get $p) (i32.const 453))
              (store.field.memarg LoopOp operand (local.get $p) (local.get $packed))))
          (local.set $i (i32.add (local.get $i) (i32.const 5)))
          (br $scan)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan))))

  ;; H451: direct semantic evaluation of the affine prefix. The three pushes
  ;; retain exact overflow/status behavior; symbolic FLD-ST and FXCH compile to
  ;; local renaming. Materialize at each following memory boundary so faults
  ;; would observe the same architectural stack as the scalar sequence.
  (func $th_x87_affine_prepare (param $op i32)
    (local $tp i32) (local $a0 i32) (local $a1 i32) (local $a3 i32)
    (local $a6 i32) (local $a8 i32)
    (local $x f64) (local $y f64) (local $sum f64)
    (local $t0 f64) (local $t1 f64) (local $t2 f64) (local $c f64)
    (local.set $tp (global.get $ip))
    (local.set $a0 (call $x87_pipeline_addr (i32.and (local.get $op) (i32.const 0xF)) (i32.load (local.get $tp))))
    (local.set $a1 (call $x87_pipeline_addr (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)) (i32.load offset=12 (local.get $tp))))
    (local.set $a3 (call $x87_pipeline_addr (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xF)) (i32.load offset=32 (local.get $tp))))
    (local.set $a6 (call $x87_pipeline_addr (i32.and (i32.shr_u (local.get $op) (i32.const 12)) (i32.const 0xF)) (i32.load offset=60 (local.get $tp))))
    (local.set $a8 (call $x87_pipeline_addr (i32.and (i32.shr_u (local.get $op) (i32.const 16)) (i32.const 0xF)) (i32.load offset=80 (local.get $tp))))
    ;; $ip already passed H451's 8-byte handler/operand record. The matched
    ;; prefix occupies 92 bytes in total, so 84 bytes remain to consume.
    (global.set $ip (i32.add (local.get $tp) (i32.const 84)))
    (local.set $x (f64.convert_i32_s (call $gl32 (local.get $a0))))
    (call $fpu_push (local.get $x))
    (local.set $y (f64.convert_i32_s (call $gl32 (local.get $a1))))
    (call $fpu_push (local.get $y))
    (call $fpu_push (local.get $y))
    (local.set $c (f64.promote_f32 (f32.load (call $g2w (local.get $a3)))))
    (local.set $t0 (f64.mul (local.get $y) (local.get $c)))
    (local.set $sum (f64.add (local.get $y) (local.get $x)))
    (call $fpu_set (i32.const 0) (local.get $x))
    (call $fpu_set (i32.const 1) (local.get $sum))
    (call $fpu_set (i32.const 2) (local.get $t0))
    (local.set $c (f64.promote_f32 (f32.load (call $g2w (local.get $a6)))))
    (local.set $t1 (f64.mul (local.get $x) (local.get $c)))
    (call $fpu_set (i32.const 0) (local.get $sum))
    (call $fpu_set (i32.const 1) (local.get $t1))
    (call $fpu_set (i32.const 2) (local.get $t0))
    (local.set $c (f64.promote_f32 (f32.load (call $g2w (local.get $a8)))))
    (local.set $t2 (f64.mul (local.get $sum) (local.get $c)))
    (call $fpu_set (i32.const 0) (local.get $t2))
    (global.set $x87_affine_prepare_runs
      (i32.add (global.get $x87_affine_prepare_runs) (i32.const 1)))
    (return_call $next))

  ;; H452: direct semantic suffix. The pop remains architecturally visible;
  ;; FXCH is only a local permutation, materialized before the next load.
  (func $th_x87_affine_finish (param $op i32)
    (local $tp i32) (local $a2 i32) (local $a4 i32)
    (local $top f64) (local $mid f64) (local $old f64)
    (local $r0 f64) (local $r1 f64) (local $bias f64)
    (local.set $tp (global.get $ip))
    (local.set $a2 (call $x87_pipeline_addr (i32.and (local.get $op) (i32.const 0xF)) (i32.load offset=16 (local.get $tp))))
    (local.set $a4 (call $x87_pipeline_addr (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)) (i32.load offset=36 (local.get $tp))))
    ;; As above, $next already consumed the first 8 bytes of this 48-byte
    ;; region; advance over only the remaining 40 bytes.
    (global.set $ip (i32.add (local.get $tp) (i32.const 40)))
    (local.set $top (call $fpu_get (i32.const 0)))
    (local.set $mid (call $fpu_get (i32.const 1)))
    (local.set $old (call $fpu_get (i32.const 2)))
    (local.set $r1 (f64.add (local.get $mid) (local.get $top)))
    (local.set $r0 (f64.sub (local.get $old) (local.get $top)))
    (if (i32.eqz (call $fpu_is_valid (i32.const 0)))
      (then (call $fpu_set_exc (i32.const 0x41))))
    (call $fpu_mark_empty (i32.const 0))
    (global.set $fpu_top
      (i32.and (i32.add (global.get $fpu_top) (i32.const 1)) (i32.const 7)))
    (call $fpu_set (i32.const 0) (local.get $r1))
    (call $fpu_set (i32.const 1) (local.get $r0))
    (local.set $bias (f64.promote_f32 (f32.load (call $g2w (local.get $a2)))))
    (local.set $r1 (f64.add (local.get $r1) (local.get $bias)))
    (call $fpu_set (i32.const 0) (local.get $r1))
    ;; Compiled FXCH ST(1): swap symbolic names, then expose the exact state at
    ;; the following memory boundary without invoking the generic FXCH helper.
    (call $fpu_set (i32.const 0) (local.get $r0))
    (call $fpu_set (i32.const 1) (local.get $r1))
    (local.set $bias (f64.promote_f32 (f32.load (call $g2w (local.get $a4)))))
    (local.set $r0 (f64.add (local.get $r0) (local.get $bias)))
    (call $fpu_set (i32.const 0) (local.get $r0))
    (global.set $x87_affine_finish_runs
      (i32.add (global.get $x87_affine_finish_runs) (i32.const 1)))
    (return_call $next))

  ;; Collapse a maximal contiguous run of ordinary x87 memory/register ops
  ;; into one dispatch while continuing to use the canonical semantic helpers.
  ;; The original threaded records remain in place and are the micro-op stream;
  ;; only the first handler/operand pair is replaced. Packed operand:
  ;;   bits 0..11 original operand, 12..19 original handler, 20..27 op count.
  ;; Runs containing an EA_TEMP-dependent H188 are accepted only when it is the
  ;; first op: a later SIB form would require an intervening EA producer.
  (func $x87_island_fuse_block
    (local $i i32) (local $j i32) (local $n i32) (local $p i32)
    (local $fn i32) (local $count i32) (local $first_op i32)
    (if (global.get $op_index_poison) (then (return)))
    (local.set $n (global.get $op_index_n))
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $p (call $loop_op_at (local.get $i)))
      (local.set $fn (load.field LoopOp handler (local.get $p)))
      (if (i32.or
            (i32.eq (local.get $fn) (i32.const 188))
            (i32.or (i32.eq (local.get $fn) (i32.const 189))
                    (i32.eq (local.get $fn) (i32.const 190))))
        (then
          (local.set $j (local.get $i))
          (local.set $count (i32.const 0))
          (block $run_done (loop $run
            (br_if $run_done (i32.ge_u (local.get $j) (local.get $n)))
            (local.set $p (call $loop_op_at (local.get $j)))
            (local.set $fn (load.field LoopOp handler (local.get $p)))
            (br_if $run_done
              (i32.eqz
                (i32.or
                  (i32.eq (local.get $fn) (i32.const 188))
                  (i32.or (i32.eq (local.get $fn) (i32.const 189))
                          (i32.eq (local.get $fn) (i32.const 190))))))
            (if (i32.and
                  (i32.and (i32.ne (local.get $j) (local.get $i))
                           (i32.eq (local.get $fn) (i32.const 188)))
                  (i32.eq (i32.load offset=8 (local.get $p)) (global.get $SIB_SENTINEL)))
              (then (br $run_done)))
            (local.set $count (i32.add (local.get $count) (i32.const 1)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br_if $run_done (i32.ge_u (local.get $count) (i32.const 255)))
            (br $run)))
          (if (i32.ge_u (local.get $count) (i32.const 3))
            (then
              (local.set $p (call $loop_op_at (local.get $i)))
              (local.set $fn (load.field LoopOp handler (local.get $p)))
              (local.set $first_op (load.field.memarg LoopOp operand (local.get $p)))
              (global.set $x87_island_matches
                (i32.add (global.get $x87_island_matches) (i32.const 1)))
              (if (global.get $x87_pipeline4_emit_enabled)
                (then
                  (store.field LoopOp handler (local.get $p) (i32.const 451))
                  (store.field.memarg LoopOp operand (local.get $p)
                    (i32.or
                      (i32.and (local.get $first_op) (i32.const 0xFFF))
                      (i32.or
                        (i32.shl (local.get $fn) (i32.const 12))
                        (i32.shl (local.get $count) (i32.const 20)))))))
              (local.set $i (local.get $j))
              (br $scan)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan))))

  ;; Generic x87 micro-op inner loop. This eliminates threaded dispatch and
  ;; keeps the canonical stack/tag/status semantics in $fpu_exec_mem/reg.
  (func $th_x87_island (param $packed i32)
    (local $cursor i32) (local $fn i32) (local $op i32)
    (local $count i32) (local $i i32) (local $addr i32)
    (local.set $cursor (global.get $ip))
    (local.set $fn (i32.and (i32.shr_u (local.get $packed) (i32.const 12)) (i32.const 0xFF)))
    (local.set $op (i32.and (local.get $packed) (i32.const 0xFFF)))
    (local.set $count (i32.and (i32.shr_u (local.get $packed) (i32.const 20)) (i32.const 0xFF)))
    (block $done (loop $each
      (if (i32.eq (local.get $fn) (i32.const 188))
        (then
          (local.set $addr (i32.load (local.get $cursor)))
          (local.set $cursor (i32.add (local.get $cursor) (i32.const 4)))
          (if (i32.eq (local.get $addr) (global.get $SIB_SENTINEL))
            (then (local.set $addr (global.get $ea_temp))))
          (call $fpu_exec_mem
            (i32.shr_u (local.get $op) (i32.const 4))
            (i32.and (local.get $op) (i32.const 0xF))
            (local.get $addr)))
        (else (if (i32.eq (local.get $fn) (i32.const 190))
          (then
            (local.set $addr
              (i32.add
                (call $get_reg (i32.and (local.get $op) (i32.const 0xF)))
                (i32.load (local.get $cursor))))
            (local.set $cursor (i32.add (local.get $cursor) (i32.const 4)))
            (call $fpu_exec_mem
              (i32.shr_u (local.get $op) (i32.const 8))
              (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
              (local.get $addr)))
          (else
            (call $fpu_exec_reg
              (i32.shr_u (local.get $op) (i32.const 8))
              (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
              (i32.and (local.get $op) (i32.const 0xF)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
      (local.set $fn (i32.load (local.get $cursor)))
      (local.set $op (i32.load offset=4 (local.get $cursor)))
      (local.set $cursor (i32.add (local.get $cursor) (i32.const 8)))
      (br $each)))
    (global.set $ip (local.get $cursor))
    (global.set $x87_island_runs
      (i32.add (global.get $x87_island_runs) (i32.const 1)))
    (return_call $next))

  ;; Does this block end in a conditional branch back to its own entry?
  (func $loop_is_selfloop (param $start_eip i32) (result i32)
    (local $p i32)
    (if (i32.lt_u (global.get $op_index_n) (i32.const 2)) (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at
      (i32.sub (global.get $op_index_n) (i32.const 1))))
    (if (i32.eqz (call $loop_is_jcc (load.field LoopOp handler (local.get $p))))
      (then (return (i32.const 0))))
    ;; words after the header: +8 fall-through, +12 target
    (i32.eq (i32.load offset=12 (local.get $p)) (local.get $start_eip)))

  ;; Flag-gated decode-time dump: marker, entry EIP, op count, then
  ;; (handler index, operand) per op. Decoded by tools/loopmatch-decode.js.
  (func $loop_trace_block (param $start_eip i32)
    (local $i i32) (local $p i32)
    (call $host_log_i32 (i32.const 0x100B0000))
    (call $host_log_i32 (local.get $start_eip))
    (call $host_log_i32 (global.get $op_index_n))
    (local.set $i (i32.const 0))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (global.get $op_index_n)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (call $host_log_i32 (load.field LoopOp handler (local.get $p)))
        (call $host_log_i32 (load.field.memarg LoopOp operand (local.get $p)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each))))

  ;; ------------------------------------------------------------------
  ;; LUT_RUN
  ;; ------------------------------------------------------------------
  ;;   dst[i] = table[src[i]] for a counted run, e.g. Heroes II's shadow
  ;;   remap at 0x004c755d:
  ;;
  ;;     xor eax,eax / inc esi / mov al,[esi-1] / mov [g0],esi
  ;;     dec edx     / mov [g1],ecx / mov al,[eax+ecx] / mov [esi-1],al / jnz ^
  ;;
  ;; The predicate below is written against ROLES, not against that sequence:
  ;; the registers, the two displacements, the induction stride, the direction
  ;; of the counter and the presence of the two spill stores are all
  ;; parameters. Order within the body does not matter except where it changes
  ;; meaning, and where it does (whether the cursor is bumped before or after
  ;; the memory access) it is folded into the displacement at match time.
  ;;
  ;; Both this counted recognizer and the bounded recognizer below emit one
  ;; universal descriptor. Execution is shared; recognition remains separate
  ;; because proving JNZ(counter) and JB(cursor,bound) safe needs different
  ;; predicates.
  ;;
  ;; Parameter block, emitted as raw words after the super-op header:
  ;;   0 src_reg     1 src_stride  2 src_disp
  ;;   3 dst_reg     4 dst_stride  5 dst_disp
  ;;   6 tbl_reg     7 acc_reg     8 index_shift  9 index_add_reg (-1 = none)
  ;;  10 term_kind (0=count NZ, 1=cursor below bound)
  ;;  11 term_reg    12 term_step
  ;;  13 m0_addr    14 m0_reg     15 m0_adj
  ;;  16 m1_addr    17 m1_reg     18 m1_adj
  ;;  19 fall_eip   20 back_eip   21 steps_per_iter
  ;;
  ;; Header operand value 1 selects the optional two-moving-source extension:
  ;;  22 src2_reg   23 src2_stride 24 src2_disp
  ;;  25 aux_reg    26 table_disp  27 term_stream (0=src1, 1=src2)
  ;; In that form the lookup index is `(src1_byte << index_shift) + src2_byte`.
  ;; tbl_reg may be -1 for an absolute table rooted at table_disp. Bit 3 is the
  ;; counted one-source absolute-table form: word 6 holds the table's guest
  ;; address instead of a register index, and the descriptor stays 22 words.
  ;; Bit 1 selects the
  ;; Heroes III wide-pixel form: its one extra word is table_disp, the source
  ;; and index remain bytes, and the table load/destination store are u16.
  ;; Bit 2 on the wide form adds a stack displacement: tbl_reg is initialized
  ;; from `[esp + stack_disp]` once per H418 entry and published at exit.
  (global $LOOP_SUPEROP_LUT i32 (i32.const 418))
  (global $LOOP_LUT_PARAMS i32 (i32.const 22))

  ;; Heroes III's unlit RGB565 blitters all use this nine-op counted body:
  ;;
  ;;   xor acc,acc / mov acc8,[src] / add|sub dst,2 / inc src / dec count
  ;;   mov acc16,[table+acc*2+disp] / mov [dst+disp],acc16 / jnz ^
  ;;
  ;; The generic role matcher intentionally knows only byte consumers. Keep
  ;; this proof local and exact rather than teaching every matcher that the
  ;; H149 effective-address op plus H164 is one semantic word load.
  (func $loop_try_lut16_counted
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $op i32) (local $info i32) (local $sib_tbl i32)
    (local $acc i32) (local $src i32) (local $dst i32)
    (local $ctr i32) (local $tbl i32) (local $dst_stride i32)
    (local $src_disp i32) (local $dst_disp i32) (local $table_disp i32)
    (local $fall i32) (local $n i32) (local $first i32)
    (local $table_stack i32) (local $stack_disp i32)

    (local.set $n (global.get $op_index_n))
    (if (i32.eq (local.get $n) (i32.const 10))
      (then
        ;; The dominant H3 form reloads its invariant table pointer from a
        ;; stack local at the top of every pixel iteration.
        (local.set $p (call $loop_op_at (i32.const 0)))
        (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 343))
          (then (return (i32.const 0))))
        (local.set $tbl (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))
        (local.set $stack_disp (i32.load offset=8 (local.get $p)))
        (local.set $table_stack (i32.const 1))
        (local.set $first (i32.const 1)))
      (else
        (if (i32.ne (local.get $n) (i32.const 9))
          (then (return (i32.const 0))))))

    ;; xor acc,acc
    (local.set $p (call $loop_op_at (local.get $first)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 18))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $acc (i32.and (local.get $op) (i32.const 0xF)))
    (if (i32.or
          (i32.gt_u (local.get $acc) (i32.const 3))
          (i32.ne (i32.shr_u (local.get $op) (i32.const 4)) (local.get $acc)))
      (then (return (i32.const 0))))

    ;; mov acc8,[src+disp]
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 1))))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 28))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.shr_u (local.get $op) (i32.const 4)) (local.get $acc))
      (then (return (i32.const 0))))
    (local.set $src (i32.and (local.get $op) (i32.const 0xF)))
    (local.set $src_disp (i32.load offset=8 (local.get $p)))

    ;; add/sub dst,2. The store is after this instruction, so fold the bump
    ;; into its descriptor displacement below.
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 2))))
    (if (i32.and
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 8)))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 2))
      (then (return (i32.const 0))))
    (local.set $dst (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))
    (local.set $dst_stride
      (select (i32.const 2) (i32.const -2)
        (i32.eq (load.field LoopOp handler (local.get $p)) (i32.const 3))))

    ;; inc src / dec count
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 3))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 64))
          (i32.ne (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF))
                  (local.get $src)))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 4))))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 65))
      (then (return (i32.const 0))))
    (local.set $ctr (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))

    ;; H149 computes table+acc*2+disp, and H164 consumes its SIB_SENTINEL as
    ;; a word load into acc.
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 5))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 149))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0)))
      (then (return (i32.const 0))))
    (local.set $info (i32.load offset=8 (local.get $p)))
    (local.set $sib_tbl (i32.and (local.get $info) (i32.const 0xF)))
    (if (i32.or
          (i32.eq (local.get $sib_tbl) (i32.const 0xF))
          (i32.or
            (i32.ne
              (i32.and (i32.shr_u (local.get $info) (i32.const 4)) (i32.const 0xF))
              (local.get $acc))
            (i32.ne
              (i32.and (i32.shr_u (local.get $info) (i32.const 8)) (i32.const 3))
              (i32.const 1))))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $table_stack)
          (i32.ne (local.get $tbl) (local.get $sib_tbl)))
      (then (return (i32.const 0))))
    (local.set $tbl (local.get $sib_tbl))
    (local.set $table_disp (i32.load offset=12 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 6))))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 164))
          (i32.or
            (i32.ne (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF))
                    (local.get $acc))
            (i32.ne (i32.load offset=8 (local.get $p)) (global.get $SIB_SENTINEL))))
      (then (return (i32.const 0))))

    ;; mov [dst+disp],acc16 / jnz ^
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 7))))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 165))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.or
          (i32.ne (i32.shr_u (local.get $op) (i32.const 4)) (local.get $acc))
          (i32.ne (i32.and (local.get $op) (i32.const 0xF)) (local.get $dst)))
      (then (return (i32.const 0))))
    (local.set $dst_disp
      (i32.add (i32.load offset=8 (local.get $p)) (local.get $dst_stride)))
    (local.set $p (call $loop_op_at (i32.add (local.get $first) (i32.const 8))))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 312))
      (then (return (i32.const 0))))

    ;; All architectural roles are distinct in the observed family. Requiring
    ;; that property makes publishing registers once at exit order-equivalent.
    (if (i32.eq (local.get $acc) (local.get $src)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $acc) (local.get $dst)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $acc) (local.get $ctr)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $acc) (local.get $tbl)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $src) (local.get $dst)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $src) (local.get $ctr)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $src) (local.get $tbl)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $dst) (local.get $ctr)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $dst) (local.get $tbl)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $ctr) (local.get $tbl)) (then (return (i32.const 0))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_lut16_matches
      (i32.add (global.get $loop_lut16_matches) (i32.const 1)))
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0001))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (global.get $loop_lut_emit_enabled))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $table_stack)
          (i32.eqz (global.get $loop_lut16_stack_emit_enabled)))
      (then (return (i32.const 0))))

    (local.set $fall (i32.load offset=8 (local.get $p)))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_LUT)
      (select (i32.const 6) (i32.const 2) (local.get $table_stack)))
    (call $te_raw (local.get $src))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $src_disp))
    (call $te_raw (local.get $dst))
    (call $te_raw (local.get $dst_stride))
    (call $te_raw (local.get $dst_disp))
    (call $te_raw (local.get $tbl))
    (call $te_raw (local.get $acc))
    (call $te_raw (i32.const 1))
    (call $te_raw (i32.const -1))
    (call $te_raw (i32.const 0))
    (call $te_raw (local.get $ctr))
    (call $te_raw (i32.const -1))
    (call $te_raw (i32.const 0)) (call $te_raw (i32.const 0)) (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0)) (call $te_raw (i32.const 0)) (call $te_raw (i32.const 0))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $start_eip))
    (call $te_raw (local.get $n))
    (call $te_raw (local.get $table_disp))
    (if (local.get $table_stack)
      (then (call $te_raw (local.get $stack_disp))))
    (i32.const 1))

  (func $loop_try_lut (param $start_eip i32) (param $tstart i32) (result i32)
    (local $i i32) (local $n i32) (local $p i32) (local $fn i32) (local $op i32)
    (local $role i32)
    (local $iv_reg i32) (local $iv_stride i32) (local $iv_idx i32) (local $iv_cnt i32)
    (local $ctr_reg i32) (local $ctr_step i32) (local $ctr_idx i32) (local $ctr_cnt i32)
    (local $acc_reg i32) (local $zero_cnt i32)
    (local $ld_reg i32) (local $ld_base i32) (local $ld_disp i32) (local $ld_idx i32) (local $ld_cnt i32)
    (local $ald_reg i32) (local $ald_base i32) (local $ald_disp i32) (local $ald_idx i32)
    (local $tbl_reg i32) (local $lut_cnt i32) (local $lut_idx i32)
    (local $st_reg i32) (local $st_base i32) (local $st_disp i32) (local $st_idx i32) (local $st_cnt i32)
    (local $m0_addr i32) (local $m0_reg i32) (local $m0_idx i32)
    (local $m1_addr i32) (local $m1_reg i32) (local $m1_idx i32)
    (local $mir_cnt i32) (local $written i32) (local $info i32) (local $b i32) (local $x i32)
    (local $fall i32) (local $abs_table i32) (local $abs_lut i32)

    (local.set $n (global.get $op_index_n))
    ;; The shape needs at least zero/iv/load/lut/store/ctr/jcc.
    (if (i32.lt_u (local.get $n) (i32.const 7)) (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $n) (i32.const 16)) (then (return (i32.const 0))))
    (local.set $iv_reg (i32.const -1))
    (local.set $ctr_reg (i32.const -1))
    (local.set $acc_reg (i32.const -1))
    (local.set $tbl_reg (i32.const -1))

    ;; ---- pass 1: roles, and the set of registers the body writes ----
    (local.set $i (i32.const 0))
    (block $p1_done
      (loop $p1
        (br_if $p1_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (local.set $fn (load.field LoopOp handler (local.get $p)))
        (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
        (local.set $role (call $loop_role (local.get $fn) (local.get $op)))
        (if (i32.eq (local.get $role) (global.get $LR_UNKNOWN))
          (then (return (i32.const 0))))
        ;; MEMCTR is a role for COPY_RUN's sake, not this one. LUT_RUN models
        ;; no memory-resident counter, and its counting gates below would not
        ;; notice one -- so a block carrying it would lower to a super-op that
        ;; silently dropped the decrement. Decline explicitly.
        (if (i32.eq (local.get $role) (global.get $LR_MEMCTR))
          (then (return (i32.const 0))))

        (if (i32.eq (local.get $role) (global.get $LR_ADDI))
          (then
            ;; inc (64) / dec (65): operand is the register, step is +1 / -1.
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $op) (i32.const 0xF)))))
            ;; The first ADDI whose register also appears as a memory base is
            ;; the induction variable; that is decided in pass 2, so record
            ;; both candidates here.
            (if (i32.eqz (local.get $iv_cnt))
              (then
                (local.set $iv_reg (i32.and (local.get $op) (i32.const 0xF)))
                (local.set $iv_stride
                  (select (i32.const 1) (i32.const -1) (i32.eq (local.get $fn) (i32.const 64))))
                (local.set $iv_idx (local.get $i))
                (local.set $iv_cnt (i32.const 1)))
              (else
                (if (i32.ne (local.get $ctr_cnt) (i32.const 0)) (then (return (i32.const 0))))
                (local.set $ctr_reg (i32.and (local.get $op) (i32.const 0xF)))
                (local.set $ctr_step
                  (select (i32.const 1) (i32.const -1) (i32.eq (local.get $fn) (i32.const 64))))
                (local.set $ctr_idx (local.get $i))
                (local.set $ctr_cnt (i32.const 1))))))

        (if (i32.eq (local.get $role) (global.get $LR_ZERO))
          (then
            (local.set $zero_cnt (i32.add (local.get $zero_cnt) (i32.const 1)))
            (local.set $acc_reg (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (local.get $acc_reg))))))

        (if (i32.eq (local.get $role) (global.get $LR_LOAD8))
          (then
            (if (i32.eqz (local.get $ld_cnt))
              (then
                (local.set $ld_base (i32.and (local.get $op) (i32.const 0xF)))
                (local.set $ld_reg (i32.shr_u (local.get $op) (i32.const 4)))
                (local.set $ld_disp (i32.load offset=8 (local.get $p)))
                (local.set $ld_idx (local.get $i)))
              (else
                (if (i32.ne (local.get $ld_cnt) (i32.const 1))
                  (then (return (i32.const 0))))
                (local.set $ald_base (i32.and (local.get $op) (i32.const 0xF)))
                (local.set $ald_reg (i32.shr_u (local.get $op) (i32.const 4)))
                (local.set $ald_disp (i32.load offset=8 (local.get $p)))
                (local.set $ald_idx (local.get $i))))
            (local.set $ld_cnt (i32.add (local.get $ld_cnt) (i32.const 1)))
            ;; A byte load writes only the low 8 bits, but the accumulator is
            ;; required to have been zeroed in-block, so the whole register is
            ;; defined here.
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (local.get $ld_reg))))))

        (if (i32.eq (local.get $role) (global.get $LR_LOAD8S))
          (then
            (local.set $lut_cnt (i32.add (local.get $lut_cnt) (i32.const 1)))
            (local.set $lut_idx (local.get $i))
            (local.set $info (i32.load offset=8 (local.get $p)))
            ;; A LUT lookup indexes a table with the byte just loaded: scale 1,
            ;; no displacement, one operand the accumulator and the other a
            ;; register the body never writes.
            (if (i32.ne (i32.load offset=12 (local.get $p)) (i32.const 0))
              (then (return (i32.const 0))))
            (if (i32.ne (i32.and (i32.shr_u (local.get $info) (i32.const 8)) (i32.const 3))
                        (i32.const 0))
              (then (return (i32.const 0))))
            (local.set $b (i32.and (local.get $info) (i32.const 0xF)))
            (local.set $x (i32.and (i32.shr_u (local.get $info) (i32.const 4)) (i32.const 0xF)))
            (if (i32.or (i32.eq (local.get $b) (i32.const 0xF))
                        (i32.eq (local.get $x) (i32.const 0xF)))
              (then (return (i32.const 0))))
            ;; destination byte register, from the fused-consumer operand
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $op) (i32.const 7)))))))

        (if (i32.eq (local.get $role) (global.get $LR_STORE8))
          (then
            (local.set $st_cnt (i32.add (local.get $st_cnt) (i32.const 1)))
            (local.set $st_base (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $st_reg (i32.shr_u (local.get $op) (i32.const 4)))
            (local.set $st_disp (i32.load offset=8 (local.get $p)))
            (local.set $st_idx (local.get $i))))

        (if (i32.eq (local.get $role) (global.get $LR_MIRROR))
          (then
            (if (i32.eqz (local.get $mir_cnt))
              (then
                (local.set $m0_addr (i32.load offset=8 (local.get $p)))
                (local.set $m0_reg (local.get $op))
                (local.set $m0_idx (local.get $i)))
              (else
                (if (i32.ge_u (local.get $mir_cnt) (i32.const 2)) (then (return (i32.const 0))))
                (local.set $m1_addr (i32.load offset=8 (local.get $p)))
                (local.set $m1_reg (local.get $op))
                (local.set $m1_idx (local.get $i))))
            (local.set $mir_cnt (i32.add (local.get $mir_cnt) (i32.const 1)))))

        ;; Only the final op may be the branch.
        (if (i32.eq (local.get $role) (global.get $LR_JCC))
          (then
            (if (i32.ne (local.get $i) (i32.sub (local.get $n) (i32.const 1)))
              (then (return (i32.const 0))))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $p1)))

    ;; ---- pass 2: the predicate ----
    (if (i32.ne (local.get $iv_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $ctr_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $zero_cnt) (i32.const 1)) (then (return (i32.const 0))))
    ;; Most loops decode the table read as fused SIB LOAD8S. Jazz's hottest
    ;; palette loop uses `mov dl,[edx+absolute]`, whose simple-base decoder form
    ;; is a second LOAD8. Prove that exact dataflow and feed it to the same H418
    ;; executor with an absolute table descriptor.
    (if (i32.and (i32.eq (local.get $ld_cnt) (i32.const 2))
                  (i32.eqz (local.get $lut_cnt)))
      (then
        (if (i32.and (i32.eq (local.get $ld_base) (local.get $iv_reg))
                      (i32.eq (local.get $ald_base) (local.get $acc_reg)))
          (then
            (if (i32.ne (local.get $ald_reg) (local.get $acc_reg))
              (then (return (i32.const 0))))
            (local.set $lut_idx (local.get $ald_idx))
            (local.set $abs_table (local.get $ald_disp)))
          (else
            (if (i32.and (i32.eq (local.get $ald_base) (local.get $iv_reg))
                          (i32.eq (local.get $ld_base) (local.get $acc_reg)))
              (then
                (if (i32.ne (local.get $ld_reg) (local.get $acc_reg))
                  (then (return (i32.const 0))))
                (local.set $lut_idx (local.get $ld_idx))
                (local.set $abs_table (local.get $ld_disp))
                (local.set $ld_reg (local.get $ald_reg))
                (local.set $ld_base (local.get $ald_base))
                (local.set $ld_disp (local.get $ald_disp))
                (local.set $ld_idx (local.get $ald_idx)))
              (else (return (i32.const 0))))))
        (local.set $abs_lut (i32.const 1)))
      (else
        (if (i32.ne (local.get $ld_cnt) (i32.const 1))
          (then (return (i32.const 0))))
        (if (i32.ne (local.get $lut_cnt) (i32.const 1))
          (then (return (i32.const 0))))))
    (if (i32.ne (local.get $st_cnt) (i32.const 1)) (then (return (i32.const 0))))

    ;; The counter must be the register the exit test reads, and must not be
    ;; the cursor. We only accept the JNZ form: exit when the counter hits 0.
    (local.set $p (call $loop_op_at (i32.sub (local.get $n) (i32.const 1))))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 312)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $ctr_reg) (local.get $iv_reg)) (then (return (i32.const 0))))
    ;; The counter must be the last flag-setting op before the branch, or the
    ;; condition is not the one we are modelling.
    (if (i32.ne (local.get $ctr_idx) (i32.sub (local.get $n) (i32.const 2)))
      (then
        ;; Tolerate mirror stores between the counter and the branch: a store
        ;; to an absolute address does not touch flags.
        (local.set $i (i32.add (local.get $ctr_idx) (i32.const 1)))
        (block $tail_ok
          (loop $tail
            (br_if $tail_ok (i32.ge_u (local.get $i) (i32.sub (local.get $n) (i32.const 1))))
            (local.set $x (call $loop_op_at (local.get $i)))
            (if (i32.ne (call $loop_role (i32.load (local.get $x))
                          (i32.load offset=4 (local.get $x)))
                        (global.get $LR_MIRROR))
              (then
                ;; A byte load or store leaves flags alone too.
                (if (i32.eqz (i32.or
                      (i32.eq (call $loop_role (i32.load (local.get $x))
                                (i32.load offset=4 (local.get $x)))
                              (global.get $LR_STORE8))
                      (i32.or
                        (i32.eq (call $loop_role (i32.load (local.get $x))
                                  (i32.load offset=4 (local.get $x)))
                                (global.get $LR_LOAD8))
                        (i32.eq (call $loop_role (i32.load (local.get $x))
                                  (i32.load offset=4 (local.get $x)))
                                (global.get $LR_LOAD8S)))))
                  (then (return (i32.const 0))))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $tail)))))

    ;; Source and destination must both stream off the cursor.
    (if (i32.ne (local.get $ld_base) (local.get $iv_reg)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $st_base) (local.get $iv_reg)) (then (return (i32.const 0))))
    ;; The accumulator is zeroed, loaded from the source, used as the table
    ;; index and stored to the destination -- one register throughout.
    (if (i32.ne (local.get $ld_reg) (local.get $acc_reg)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $st_reg) (local.get $acc_reg)) (then (return (i32.const 0))))
    ;; Byte-register indices above 3 name AH/CH/DH/BH, which are not the low
    ;; byte of the register the xor zeroed. Decline rather than model them.
    (if (i32.gt_u (local.get $acc_reg) (i32.const 3)) (then (return (i32.const 0))))
    ;; The universal executor publishes the accumulator, cursors and terminator
    ;; once at the block boundary. Aliasing those architectural roles would make
    ;; their original per-instruction write order observable, so decline it.
    (if (i32.or (i32.eq (local.get $acc_reg) (local.get $iv_reg))
                (i32.eq (local.get $acc_reg) (local.get $ctr_reg)))
      (then (return (i32.const 0))))
    (if (i32.eqz (local.get $abs_lut))
      (then
        ;; The fused SIB load's destination is its own operand's low 3 bits.
        (local.set $p (call $loop_op_at (local.get $ld_idx)))
        (local.set $i (i32.const 0))
        (block $find_lut_done
          (loop $find_lut
            (br_if $find_lut_done (i32.ge_u (local.get $i) (local.get $n)))
            (local.set $x (call $loop_op_at (local.get $i)))
            (if (i32.eq (call $loop_role (i32.load (local.get $x)) (i32.load offset=4 (local.get $x)))
                        (global.get $LR_LOAD8S))
              (then
                (if (i32.ne (i32.and (i32.load offset=4 (local.get $x)) (i32.const 7))
                            (local.get $acc_reg))
                  (then (return (i32.const 0))))
                (local.set $info (i32.load offset=8 (local.get $x)))
                (local.set $b (i32.and (local.get $info) (i32.const 0xF)))
                (local.set $x (i32.and (i32.shr_u (local.get $info) (i32.const 4)) (i32.const 0xF)))
                (if (i32.eq (local.get $b) (local.get $acc_reg))
                  (then (local.set $tbl_reg (local.get $x)))
                  (else
                    (if (i32.ne (local.get $x) (local.get $acc_reg)) (then (return (i32.const 0))))
                    (local.set $tbl_reg (local.get $b))))
                (br $find_lut_done)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $find_lut)))
        (if (i32.lt_s (local.get $tbl_reg) (i32.const 0)) (then (return (i32.const 0))))
        ;; The table base has to be loop-invariant, or it is not a table.
        (if (i32.and (local.get $written)
              (i32.shl (i32.const 1) (local.get $tbl_reg)))
          (then (return (i32.const 0))))))

    ;; The source byte must be read before it is used as an index, and the
    ;; result stored after. Anything else is a different loop.
    (if (i32.ge_u (local.get $ld_idx) (local.get $lut_idx)) (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $lut_idx) (local.get $st_idx)) (then (return (i32.const 0))))

    ;; The universal executor bumps cursors after each access. An access the
    ;; original performed after its bump therefore needs one stride folded into
    ;; its displacement; an access before the bump already agrees.
    (if (i32.lt_u (local.get $iv_idx) (local.get $ld_idx))
      (then (local.set $ld_disp (i32.add (local.get $ld_disp) (local.get $iv_stride)))))
    (if (i32.lt_u (local.get $iv_idx) (local.get $st_idx))
      (then (local.set $st_disp (i32.add (local.get $st_disp) (local.get $iv_stride)))))

    ;; A mirror whose register the body writes, other than the cursor, would
    ;; need its own per-iteration value; decline instead of guessing.
    (if (i32.ne (local.get $m0_addr) (i32.const 0))
      (then
        (if (i32.and (i32.and (local.get $written)
                       (i32.shl (i32.const 1) (local.get $m0_reg)))
                     (i32.ne (local.get $m0_reg) (local.get $iv_reg)))
          (then (return (i32.const 0))))))
    (if (i32.ne (local.get $m1_addr) (i32.const 0))
      (then
        (if (i32.and (i32.and (local.get $written)
                       (i32.shl (i32.const 1) (local.get $m1_reg)))
                     (i32.ne (local.get $m1_reg) (local.get $iv_reg)))
          (then (return (i32.const 0))))))

    ;; ---- emit ----
    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    ;; Which family claimed which block. The block dump alone cannot say: it is
    ;; printed before either predicate runs, so a 387-block trace with 2 matches
    ;; in it names neither. Marker 0x100B0001 = LUT_RUN, then the entry EIP.
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0001))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (global.get $loop_lut_emit_enabled)) (then (return (i32.const 0))))

    (local.set $fall (i32.load offset=8
      (call $loop_op_at (i32.sub (local.get $n) (i32.const 1)))))
    ;; Rewind over the ops just emitted and put the super-op in their place.
    ;; This is the only rewind of $thread_alloc in the decoder, and it happens
    ;; after every emit for this block, so nothing else can be pointing into
    ;; the range being reclaimed. The op index is reset with it.
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_LUT)
      (select (i32.const 8) (i32.const 0) (local.get $abs_lut)))
    (call $te_raw (local.get $iv_reg))
    (call $te_raw (local.get $iv_stride))
    (call $te_raw (local.get $ld_disp))
    (call $te_raw (local.get $iv_reg))
    (call $te_raw (local.get $iv_stride))
    (call $te_raw (local.get $st_disp))
    (call $te_raw (select (local.get $abs_table) (local.get $tbl_reg)
      (local.get $abs_lut)))
    (call $te_raw (local.get $acc_reg))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const -1))
    (call $te_raw (i32.const 0))
    (call $te_raw (local.get $ctr_reg))
    (call $te_raw (local.get $ctr_step))
    (call $te_raw (local.get $m0_addr))
    (call $te_raw (local.get $m0_reg))
    ;; A spill of the cursor itself records whatever the cursor held at that
    ;; point in the body; the super-op writes it once, at exit, from the final
    ;; value, so a spill that ran before the bump is one stride behind.
    (call $te_raw (select (i32.sub (i32.const 0) (local.get $iv_stride)) (i32.const 0)
      (i32.and (i32.eq (local.get $m0_reg) (local.get $iv_reg))
               (i32.lt_u (local.get $m0_idx) (local.get $iv_idx)))))
    (call $te_raw (local.get $m1_addr))
    (call $te_raw (local.get $m1_reg))
    (call $te_raw (select (i32.sub (i32.const 0) (local.get $iv_stride)) (i32.const 0)
      (i32.and (i32.eq (local.get $m1_reg) (local.get $iv_reg))
               (i32.lt_u (local.get $m1_idx) (local.get $iv_idx)))))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $start_eip))
    (call $te_raw (local.get $n))
    (i32.const 1))

  ;; ------------------------------------------------------------------
  ;; Bounded LUT_RUN
  ;; ------------------------------------------------------------------
  ;; Recognizes the role-equivalent forms used by Diablo II's software pixel
  ;; paths. The simple form is dst[i] = table[src[i]]; the row-table form adds
  ;; an optional `(byte << shift) + invariant_reg` index transform. Both end in
  ;; CMP source_cursor,bound / JB back. This is deliberately a separate proof
  ;; from the counted Heroes form above, but both emit the same descriptor and
  ;; execute in handler 418.
  (func $loop_try_lut_bounded (param $start_eip i32) (param $tstart i32) (result i32)
    (local $i i32) (local $n i32) (local $p i32) (local $fn i32) (local $op i32)
    (local $role i32) (local $written i32) (local $fall i32)
    (local $acc_reg i32) (local $zero_cnt i32) (local $zero_idx i32)
    (local $ld_reg i32) (local $ld_base i32) (local $ld_disp i32)
    (local $ld_cnt i32) (local $ld_idx i32)
    (local $st_reg i32) (local $st_base i32) (local $st_disp i32)
    (local $st_cnt i32) (local $st_idx i32)
    (local $lut_cnt i32) (local $lut_idx i32) (local $lut_info i32)
    (local $tbl_reg i32) (local $b i32) (local $x i32)
    (local $shift_cnt i32) (local $shift_idx i32) (local $shift_op i32)
    (local $index_shift i32)
    (local $add_cnt i32) (local $add_idx i32) (local $add_op i32)
    (local $add_reg i32)
    (local $cmp_cnt i32) (local $cmp_idx i32) (local $cmp_left i32) (local $bound_reg i32)
    (local $addi_cnt i32) (local $addi_last_idx i32)
    (local $src_inc_cnt i32) (local $src_inc_idx i32)
    (local $dst_inc_cnt i32) (local $dst_inc_idx i32)

    (local.set $n (global.get $op_index_n))
    ;; zero/load/[shift/add]/increments/cmp/lut/store/jb: eight to ten ops in
    ;; the two observed families. A larger body is computing something else.
    (if (i32.lt_u (local.get $n) (i32.const 8)) (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $n) (i32.const 10)) (then (return (i32.const 0))))
    (local.set $acc_reg (i32.const -1))
    (local.set $tbl_reg (i32.const -1))
    (local.set $add_reg (i32.const -1))

    ;; Pass 1 records exact semantic roles. Unknown or extra work declines the
    ;; whole block; no instruction is silently dropped by the lowering.
    (local.set $i (i32.const 0))
    (block $p1_done
      (loop $p1
        (br_if $p1_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (local.set $fn (load.field LoopOp handler (local.get $p)))
        (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
        (local.set $role (call $loop_role (local.get $fn) (local.get $op)))

        (if (i32.eq (local.get $role) (global.get $LR_ZERO))
          (then
            (local.set $zero_cnt (i32.add (local.get $zero_cnt) (i32.const 1)))
            (local.set $zero_idx (local.get $i))
            (local.set $acc_reg (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (local.get $acc_reg))))))
        (if (i32.eq (local.get $role) (global.get $LR_LOAD8))
          (then
            (local.set $ld_cnt (i32.add (local.get $ld_cnt) (i32.const 1)))
            (local.set $ld_idx (local.get $i))
            (local.set $ld_base (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $ld_reg (i32.shr_u (local.get $op) (i32.const 4)))
            (local.set $ld_disp (i32.load offset=8 (local.get $p)))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $ld_reg) (i32.const 3)))))))
        (if (i32.eq (local.get $role) (global.get $LR_LOAD8S))
          (then
            (local.set $lut_cnt (i32.add (local.get $lut_cnt) (i32.const 1)))
            (local.set $lut_idx (local.get $i))
            (local.set $lut_info (i32.load offset=8 (local.get $p)))
            (if (i32.ne (i32.load offset=12 (local.get $p)) (i32.const 0))
              (then (return (i32.const 0))))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $op) (i32.const 7)))))))
        (if (i32.eq (local.get $role) (global.get $LR_STORE8))
          (then
            (local.set $st_cnt (i32.add (local.get $st_cnt) (i32.const 1)))
            (local.set $st_idx (local.get $i))
            (local.set $st_base (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $st_reg (i32.shr_u (local.get $op) (i32.const 4)))
            (local.set $st_disp (i32.load offset=8 (local.get $p)))))
        (if (i32.eq (local.get $role) (global.get $LR_ADDI))
          (then
            ;; Bounded streams are forward byte walks only.
            (if (i32.ne (local.get $fn) (i32.const 64)) (then (return (i32.const 0))))
            (local.set $addi_cnt (i32.add (local.get $addi_cnt) (i32.const 1)))
            (local.set $addi_last_idx (local.get $i))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $op) (i32.const 0xF)))))))
        (if (i32.eq (local.get $role) (global.get $LR_SHIFT))
          (then
            (local.set $shift_cnt (i32.add (local.get $shift_cnt) (i32.const 1)))
            (local.set $shift_idx (local.get $i))
            (local.set $shift_op (local.get $op))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $op) (i32.const 0xFF)))))))
        (if (i32.eq (local.get $role) (global.get $LR_ADD))
          (then
            (local.set $add_cnt (i32.add (local.get $add_cnt) (i32.const 1)))
            (local.set $add_idx (local.get $i))
            (local.set $add_op (local.get $op))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.shr_u (local.get $op) (i32.const 4)))))))
        (if (i32.eq (local.get $role) (global.get $LR_CMP))
          (then
            (local.set $cmp_cnt (i32.add (local.get $cmp_cnt) (i32.const 1)))
            (local.set $cmp_idx (local.get $i))
            (local.set $cmp_left (i32.shr_u (local.get $op) (i32.const 4)))
            (local.set $bound_reg (i32.and (local.get $op) (i32.const 0xF)))))
        (if (i32.eq (local.get $role) (global.get $LR_JCC))
          (then
            (if (i32.ne (local.get $i) (i32.sub (local.get $n) (i32.const 1)))
              (then (return (i32.const 0))))
            ;; JB/JC/JNAE is handler 309. No signed or equality variant is an
            ;; interchangeable bound check.
            (if (i32.ne (local.get $fn) (i32.const 309))
              (then (return (i32.const 0))))))
        (if (i32.or
              (i32.eq (local.get $role) (global.get $LR_UNKNOWN))
              (i32.or (i32.eq (local.get $role) (global.get $LR_MIRROR))
                      (i32.eq (local.get $role) (global.get $LR_MEMCTR))))
          (then (return (i32.const 0))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $p1)))

    (if (i32.ne (local.get $zero_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $ld_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $lut_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $st_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $cmp_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $shift_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $add_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $acc_reg) (i32.const 3)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $ld_reg) (local.get $acc_reg)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $st_reg) (local.get $acc_reg)) (then (return (i32.const 0))))

    ;; Zero -> source byte -> optional shift/add -> table byte -> destination.
    (if (i32.ge_u (local.get $zero_idx) (local.get $ld_idx)) (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $ld_idx) (local.get $lut_idx)) (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $lut_idx) (local.get $st_idx)) (then (return (i32.const 0))))
    (if (local.get $shift_cnt)
      (then
        (if (i32.or (i32.le_u (local.get $shift_idx) (local.get $ld_idx))
                    (i32.ge_u (local.get $shift_idx) (local.get $lut_idx)))
          (then (return (i32.const 0))))
        (if (i32.ne (i32.and (local.get $shift_op) (i32.const 0xFF)) (local.get $acc_reg))
          (then (return (i32.const 0))))
        (if (i32.eqz (i32.or
              (i32.eq (i32.and (i32.shr_u (local.get $shift_op) (i32.const 8)) (i32.const 0xFF)) (i32.const 4))
              (i32.eq (i32.and (i32.shr_u (local.get $shift_op) (i32.const 8)) (i32.const 0xFF)) (i32.const 6))))
          (then (return (i32.const 0))))
        (local.set $index_shift
          (i32.and (i32.shr_u (local.get $shift_op) (i32.const 16)) (i32.const 0xFF)))
        (if (i32.ne (local.get $index_shift) (i32.const 8))
          (then (return (i32.const 0))))))
    (if (local.get $add_cnt)
      (then
        (if (i32.or (i32.le_u (local.get $add_idx) (local.get $ld_idx))
                    (i32.ge_u (local.get $add_idx) (local.get $lut_idx)))
          (then (return (i32.const 0))))
        (if (i32.ne (i32.shr_u (local.get $add_op) (i32.const 4)) (local.get $acc_reg))
          (then (return (i32.const 0))))
        (local.set $add_reg (i32.and (local.get $add_op) (i32.const 0xF)))
        (if (i32.and (local.get $shift_cnt)
              (i32.le_u (local.get $add_idx) (local.get $shift_idx)))
          (then (return (i32.const 0))))))

    ;; The fused SIB lookup must be exactly [table + accumulator], scale 1,
    ;; displacement zero, and write the same low-byte accumulator.
    (local.set $p (call $loop_op_at (local.get $lut_idx)))
    (if (i32.ne (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 7))
                (local.get $acc_reg))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.and (i32.shr_u (local.get $lut_info) (i32.const 8)) (i32.const 3))
                (i32.const 0))
      (then (return (i32.const 0))))
    (local.set $b (i32.and (local.get $lut_info) (i32.const 0xF)))
    (local.set $x (i32.and (i32.shr_u (local.get $lut_info) (i32.const 4)) (i32.const 0xF)))
    (if (i32.eq (local.get $b) (local.get $acc_reg))
      (then (local.set $tbl_reg (local.get $x)))
      (else
        (if (i32.ne (local.get $x) (local.get $acc_reg)) (then (return (i32.const 0))))
        (local.set $tbl_reg (local.get $b))))
    (if (i32.or (i32.eq (local.get $tbl_reg) (i32.const 0xF))
                (i32.lt_s (local.get $tbl_reg) (i32.const 0)))
      (then (return (i32.const 0))))

    ;; Sort the one or two INC ops by the memory-base roles.
    (local.set $i (i32.const 0))
    (block $incs_done
      (loop $incs
        (br_if $incs_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (if (i32.eq (call $loop_role (load.field LoopOp handler (local.get $p)) (load.field.memarg LoopOp operand (local.get $p)))
                    (global.get $LR_ADDI))
          (then
            (local.set $x (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))
            (if (i32.eq (local.get $x) (local.get $ld_base))
              (then
                (local.set $src_inc_cnt (i32.add (local.get $src_inc_cnt) (i32.const 1)))
                (local.set $src_inc_idx (local.get $i))))
            (if (i32.eq (local.get $x) (local.get $st_base))
              (then
                (local.set $dst_inc_cnt (i32.add (local.get $dst_inc_cnt) (i32.const 1)))
                (local.set $dst_inc_idx (local.get $i))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $incs)))
    (if (i32.ne (local.get $src_inc_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $dst_inc_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $addi_cnt)
          (select (i32.const 1) (i32.const 2)
            (i32.eq (local.get $ld_base) (local.get $st_base))))
      (then (return (i32.const 0))))

    ;; CMP source,bound must be the final flag writer and JB must be the final
    ;; op. Bound/table/row are invariant; accumulator/cursors/terminator do not
    ;; alias, so publishing them once at exit preserves architectural state.
    (if (i32.ne (local.get $cmp_left) (local.get $ld_base)) (then (return (i32.const 0))))
    (if (i32.or (i32.le_u (local.get $cmp_idx) (local.get $zero_idx))
                (i32.le_u (local.get $cmp_idx) (local.get $addi_last_idx)))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $shift_cnt) (i32.le_u (local.get $cmp_idx) (local.get $shift_idx)))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $add_cnt) (i32.le_u (local.get $cmp_idx) (local.get $add_idx)))
      (then (return (i32.const 0))))
    (if (i32.or (i32.eq (local.get $acc_reg) (local.get $ld_base))
          (i32.or (i32.eq (local.get $acc_reg) (local.get $st_base))
                  (i32.eq (local.get $acc_reg) (local.get $bound_reg))))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $written) (i32.shl (i32.const 1) (local.get $bound_reg)))
      (then (return (i32.const 0))))
    (if (i32.and (local.get $written) (i32.shl (i32.const 1) (local.get $tbl_reg)))
      (then (return (i32.const 0))))
    (if (i32.and (i32.ge_s (local.get $add_reg) (i32.const 0))
          (i32.and (local.get $written) (i32.shl (i32.const 1) (local.get $add_reg))))
      (then (return (i32.const 0))))

    ;; Convert original pre-access increments to the executor's post-access
    ;; cursor convention.
    (if (i32.lt_u (local.get $src_inc_idx) (local.get $ld_idx))
      (then (local.set $ld_disp (i32.add (local.get $ld_disp) (i32.const 1)))))
    (if (i32.lt_u (local.get $dst_inc_idx) (local.get $st_idx))
      (then (local.set $st_disp (i32.add (local.get $st_disp) (i32.const 1)))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_lut_bounded_matches
      (i32.add (global.get $loop_lut_bounded_matches) (i32.const 1)))
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0003))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (global.get $loop_lut_emit_enabled)) (then (return (i32.const 0))))

    (local.set $fall (i32.load offset=8
      (call $loop_op_at (i32.sub (local.get $n) (i32.const 1)))))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_LUT) (i32.const 0))
    (call $te_raw (local.get $ld_base))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $ld_disp))
    (call $te_raw (local.get $st_base))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $st_disp))
    (call $te_raw (local.get $tbl_reg))
    (call $te_raw (local.get $acc_reg))
    (call $te_raw (local.get $index_shift))
    (call $te_raw (local.get $add_reg))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $bound_reg))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $start_eip))
    (call $te_raw (local.get $n))
    (i32.const 1))

  ;; ------------------------------------------------------------------
  ;; Two-moving-source bounded LUT_RUN
  ;; ------------------------------------------------------------------
  ;; d2gfx's remaining blend loop builds a 16-bit index from two advancing
  ;; byte streams and stops on the second cursor:
  ;;
  ;;   xor acc,acc / xor aux,aux
  ;;   mov acc8,[src1] / mov aux8,[src2] / shl acc,8
  ;;   inc dst / inc src2 / mov acc8,[acc+aux+table]
  ;;   inc src1 / mov [dst-1],acc8 / cmp src2,bound / jb ^
  ;;
  ;; Recognition is intentionally separate from the one-source proof above,
  ;; while execution stays in universal H418 through descriptor version 1.
  ;; The role order is exact because every ordering point is architecturally
  ;; meaningful here; registers and displacements remain parameters.
  (func $loop_try_lut_blend_bounded
        (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $op i32) (local $info i32) (local $fall i32)
    (local $acc i32) (local $aux i32)
    (local $src1 i32) (local $src1_disp i32) (local $src1_inc i32)
    (local $src2 i32) (local $src2_disp i32) (local $src2_inc i32)
    (local $dst i32) (local $dst_disp i32) (local $dst_inc i32)
    (local $bound i32) (local $table_disp i32)
    (local $r i32) (local $i i32) (local $mask i32) (local $want i32)

    (if (i32.ne (global.get $op_index_n) (i32.const 12))
      (then (return (i32.const 0))))

    ;; Two zeroing instructions establish exact full-register scratch state.
    (local.set $p (call $loop_op_at (i32.const 0)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_ZERO))
      (then (return (i32.const 0))))
    (local.set $acc (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))
    (local.set $p (call $loop_op_at (i32.const 1)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_ZERO))
      (then (return (i32.const 0))))
    (local.set $aux (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))
    (if (i32.or (i32.gt_u (local.get $acc) (i32.const 3))
                (i32.or (i32.gt_u (local.get $aux) (i32.const 3))
                        (i32.eq (local.get $acc) (local.get $aux))))
      (then (return (i32.const 0))))

    ;; Primary/high byte source.
    (local.set $p (call $loop_op_at (i32.const 2)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_LOAD8))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.and (i32.shr_u (local.get $op) (i32.const 4))
                         (i32.const 0xF)) (local.get $acc))
      (then (return (i32.const 0))))
    (local.set $src1 (i32.and (local.get $op) (i32.const 0xF)))
    (local.set $src1_disp (i32.load offset=8 (local.get $p)))

    ;; Secondary/low byte source.
    (local.set $p (call $loop_op_at (i32.const 3)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_LOAD8))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.and (i32.shr_u (local.get $op) (i32.const 4))
                         (i32.const 0xF)) (local.get $aux))
      (then (return (i32.const 0))))
    (local.set $src2 (i32.and (local.get $op) (i32.const 0xF)))
    (local.set $src2_disp (i32.load offset=8 (local.get $p)))

    ;; Exact `shl acc,8`.
    (local.set $p (call $loop_op_at (i32.const 4)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_SHIFT))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.and (local.get $op) (i32.const 0xFF)) (local.get $acc))
      (then (return (i32.const 0))))
    (if (i32.eqz (i32.or
          (i32.eq (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xFF))
                  (i32.const 4))
          (i32.eq (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xFF))
                  (i32.const 6))))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.and (i32.shr_u (local.get $op) (i32.const 16))
                         (i32.const 0xFF)) (i32.const 8))
      (then (return (i32.const 0))))

    ;; The lookup writes acc8 and addresses exactly [acc+aux+table_disp].
    (local.set $p (call $loop_op_at (i32.const 7)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_LOAD8S))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.and (local.get $op) (i32.const 7)) (local.get $acc))
      (then (return (i32.const 0))))
    (local.set $info (i32.load offset=8 (local.get $p)))
    (if (i32.ne (i32.and (i32.shr_u (local.get $info) (i32.const 8))
                         (i32.const 3)) (i32.const 0))
      (then (return (i32.const 0))))
    (if (i32.eqz (i32.or
          (i32.and
            (i32.eq (i32.and (local.get $info) (i32.const 0xF)) (local.get $acc))
            (i32.eq (i32.and (i32.shr_u (local.get $info) (i32.const 4))
                             (i32.const 0xF)) (local.get $aux)))
          (i32.and
            (i32.eq (i32.and (local.get $info) (i32.const 0xF)) (local.get $aux))
            (i32.eq (i32.and (i32.shr_u (local.get $info) (i32.const 4))
                             (i32.const 0xF)) (local.get $acc)))))
      (then (return (i32.const 0))))
    (local.set $table_disp (i32.load offset=12 (local.get $p)))

    ;; Result store and final unsigned source2 bound check.
    (local.set $p (call $loop_op_at (i32.const 9)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_STORE8))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.and (i32.shr_u (local.get $op) (i32.const 4))
                         (i32.const 0xF)) (local.get $acc))
      (then (return (i32.const 0))))
    (local.set $dst (i32.and (local.get $op) (i32.const 0xF)))
    (local.set $dst_disp (i32.load offset=8 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 10)))
    (if (i32.ne (call $loop_role (load.field LoopOp handler (local.get $p))
                  (load.field.memarg LoopOp operand (local.get $p))) (global.get $LR_CMP))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.and (i32.shr_u (local.get $op) (i32.const 4))
                         (i32.const 0xF)) (local.get $src2))
      (then (return (i32.const 0))))
    (local.set $bound (i32.and (local.get $op) (i32.const 0xF)))
    (local.set $p (call $loop_op_at (i32.const 11)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 309))
      (then (return (i32.const 0))))

    ;; Positions 5, 6 and 8 must be one INC for each distinct cursor. Record
    ;; where they occur so a pre-access increment can be folded into its disp.
    (if (i32.or (i32.eq (local.get $src1) (local.get $src2))
          (i32.or (i32.eq (local.get $src1) (local.get $dst))
                  (i32.eq (local.get $src2) (local.get $dst))))
      (then (return (i32.const 0))))
    (local.set $i (i32.const 5))
    (block $incs_done (loop $incs
      (local.set $p (call $loop_op_at (local.get $i)))
      (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 64))
        (then (return (i32.const 0))))
      (local.set $r (i32.and (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xF)))
      (local.set $mask (i32.or (local.get $mask)
        (i32.shl (i32.const 1) (local.get $r))))
      (if (i32.eq (local.get $r) (local.get $src1))
        (then (local.set $src1_inc (local.get $i))))
      (if (i32.eq (local.get $r) (local.get $src2))
        (then (local.set $src2_inc (local.get $i))))
      (if (i32.eq (local.get $r) (local.get $dst))
        (then (local.set $dst_inc (local.get $i))))
      (local.set $i (select (i32.const 8) (i32.add (local.get $i) (i32.const 1))
                           (i32.eq (local.get $i) (i32.const 6))))
      (br_if $incs_done (i32.gt_u (local.get $i) (i32.const 8)))
      (br $incs)))
    (local.set $want (i32.or
      (i32.shl (i32.const 1) (local.get $src1))
      (i32.or (i32.shl (i32.const 1) (local.get $src2))
              (i32.shl (i32.const 1) (local.get $dst)))))
    (if (i32.ne (local.get $mask) (local.get $want))
      (then (return (i32.const 0))))

    ;; Scratch, cursors, bound and destination are independent. The executor
    ;; snapshots them all, but no accepted guest instruction aliases these
    ;; roles either, so final register publication is unambiguous.
    (local.set $mask (i32.or
      (i32.shl (i32.const 1) (local.get $src1))
      (i32.or (i32.shl (i32.const 1) (local.get $src2))
        (i32.or (i32.shl (i32.const 1) (local.get $dst))
                (i32.shl (i32.const 1) (local.get $bound))))))
    (if (i32.or
          (i32.and (local.get $mask) (i32.shl (i32.const 1) (local.get $acc)))
          (i32.and (local.get $mask) (i32.shl (i32.const 1) (local.get $aux))))
      (then (return (i32.const 0))))
    (if (i32.or (i32.eq (local.get $bound) (local.get $src1))
          (i32.or (i32.eq (local.get $bound) (local.get $src2))
                  (i32.eq (local.get $bound) (local.get $dst))))
      (then (return (i32.const 0))))

    (if (i32.lt_u (local.get $src1_inc) (i32.const 2))
      (then (local.set $src1_disp (i32.add (local.get $src1_disp) (i32.const 1)))))
    (if (i32.lt_u (local.get $src2_inc) (i32.const 3))
      (then (local.set $src2_disp (i32.add (local.get $src2_disp) (i32.const 1)))))
    (if (i32.lt_u (local.get $dst_inc) (i32.const 9))
      (then (local.set $dst_disp (i32.add (local.get $dst_disp) (i32.const 1)))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_lut_bounded_matches
      (i32.add (global.get $loop_lut_bounded_matches) (i32.const 1)))
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0003))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (global.get $loop_lut_emit_enabled))
      (then (return (i32.const 0))))

    (local.set $fall (i32.load offset=8 (call $loop_op_at (i32.const 11))))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_LUT) (i32.const 1))
    (call $te_raw (local.get $src1))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $src1_disp))
    (call $te_raw (local.get $dst))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $dst_disp))
    (call $te_raw (i32.const -1))
    (call $te_raw (local.get $acc))
    (call $te_raw (i32.const 8))
    (call $te_raw (i32.const -1))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $bound))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (i32.const 0))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $start_eip))
    (call $te_raw (i32.const 12))
    (call $te_raw (local.get $src2))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $src2_disp))
    (call $te_raw (local.get $aux))
    (call $te_raw (local.get $table_disp))
    (call $te_raw (i32.const 1))
    (i32.const 1))

  ;; Emit the common H435 stream descriptor. Keeping this mechanical packing
  ;; in one place lets recognizers focus on proving their guest instruction
  ;; order rather than duplicating a 21-word ABI.
  (func $loop_emit_avg
    (param $mode i32) (param $mask i32) (param $round_mask i32)
    (param $a_base i32) (param $a_index i32) (param $a_scale i32)
    (param $a_disp i32) (param $a_step i32)
    (param $b_base i32) (param $b_index i32) (param $b_scale i32)
    (param $b_disp i32) (param $b_step i32)
    (param $d_base i32) (param $d_index i32) (param $d_scale i32)
    (param $d_disp i32) (param $d_step i32)
    (param $ind i32) (param $ind_step i32) (param $term i32) (param $cost i32)
    (call $te (global.get $LOOP_SUPEROP_AVG) (local.get $mode))
    (call $te_raw (local.get $mask))
    (call $te_raw (local.get $round_mask))
    (call $te_raw (local.get $a_base))
    (call $te_raw (local.get $a_index))
    (call $te_raw (local.get $a_scale))
    (call $te_raw (local.get $a_disp))
    (call $te_raw (local.get $a_step))
    (call $te_raw (local.get $b_base))
    (call $te_raw (local.get $b_index))
    (call $te_raw (local.get $b_scale))
    (call $te_raw (local.get $b_disp))
    (call $te_raw (local.get $b_step))
    (call $te_raw (local.get $d_base))
    (call $te_raw (local.get $d_index))
    (call $te_raw (local.get $d_scale))
    (call $te_raw (local.get $d_disp))
    (call $te_raw (local.get $d_step))
    (call $te_raw (local.get $ind))
    (call $te_raw (local.get $ind_step))
    (call $te_raw (local.get $term))
    (call $te_raw (local.get $cost)))

  ;; The carry-wide form seen twice in Abe, generalized over all register
  ;; roles, SIB layouts, displacements and masks:
  ;;
  ;;   mov A,[baseA+index*scale+dispA]
  ;;   mov B,[baseB+index*scale+dispB]
  ;;   and A,mask / and B,mask / add A,B / rcr A,1
  ;;   mov [baseD+index*scale+dispD],A / dec index / jge ^
  (func $loop_try_avg_wide_indexed
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $fn i32) (local $branch_op i32)
    (local $a i32) (local $b i32) (local $ind i32)
    (local $a_info i32) (local $b_info i32) (local $d_info i32)
    (local $a_base i32) (local $b_base i32) (local $d_base i32)
    (local $scale i32) (local $mask i32)
    (local $a_disp i32) (local $b_disp i32) (local $d_disp i32)
    (local $fall i32) (local $back i32) (local $regs i32)

    (if (i32.ne (global.get $op_index_n) (i32.const 9))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 0)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 389))
      (then (return (i32.const 0))))
    (local.set $a (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $a_info (i32.load offset=8 (local.get $p)))
    (local.set $a_disp (i32.load offset=12 (local.get $p)))

    (local.set $p (call $loop_op_at (i32.const 1)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 389))
      (then (return (i32.const 0))))
    (local.set $b (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $b_info (i32.load offset=8 (local.get $p)))
    (local.set $b_disp (i32.load offset=12 (local.get $p)))

    ;; Equal immediate masks on the two loaded values.
    (local.set $p (call $loop_op_at (i32.const 2)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $mask (i32.load offset=8 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 3)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $b))
                  (i32.ne (i32.load offset=8 (local.get $p)) (local.get $mask))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 4)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 12))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $b))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 5)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 53))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (local.get $a) (i32.const 0x10300))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 6)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 420))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $d_info (i32.load offset=8 (local.get $p)))
    (local.set $d_disp (i32.load offset=12 (local.get $p)))

    (local.set $p (call $loop_op_at (i32.const 7)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 65))
      (then (return (i32.const 0))))
    (local.set $ind (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 8)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 320))
      (then (return (i32.const 0))))
    (local.set $branch_op (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $fall (i32.load offset=8 (local.get $p)))
    (local.set $back (i32.load offset=12 (local.get $p)))

    (local.set $a_base (i32.and (local.get $a_info) (i32.const 0xF)))
    (local.set $b_base (i32.and (local.get $b_info) (i32.const 0xF)))
    (local.set $d_base (i32.and (local.get $d_info) (i32.const 0xF)))
    (local.set $scale (i32.and (i32.shr_u (local.get $a_info) (i32.const 8)) (i32.const 3)))
    ;; All streams use the induction register with one scale. Reject absent or
    ;; non-register bases and every alias that would make a load overwrite an
    ;; address component used later in the same original iteration.
    (if (i32.or
          (i32.or (i32.ge_u (local.get $a_base) (i32.const 8))
                  (i32.ge_u (local.get $b_base) (i32.const 8)))
          (i32.ge_u (local.get $d_base) (i32.const 8)))
      (then (return (i32.const 0))))
    (if (i32.or
          (i32.ne (i32.and (i32.shr_u (local.get $a_info) (i32.const 4)) (i32.const 0xF))
                  (local.get $ind))
          (i32.or
            (i32.ne (i32.and (i32.shr_u (local.get $b_info) (i32.const 4)) (i32.const 0xF))
                    (local.get $ind))
            (i32.ne (i32.and (i32.shr_u (local.get $d_info) (i32.const 4)) (i32.const 0xF))
                    (local.get $ind))))
      (then (return (i32.const 0))))
    (if (i32.or
          (i32.ne (i32.and (i32.shr_u (local.get $b_info) (i32.const 8)) (i32.const 3))
                  (local.get $scale))
          (i32.ne (i32.and (i32.shr_u (local.get $d_info) (i32.const 8)) (i32.const 3))
                  (local.get $scale)))
      (then (return (i32.const 0))))
    (local.set $regs
      (i32.or (i32.shl (i32.const 1) (local.get $a))
        (i32.or (i32.shl (i32.const 1) (local.get $b))
          (i32.or (i32.shl (i32.const 1) (local.get $ind))
            (i32.or (i32.shl (i32.const 1) (local.get $a_base))
              (i32.or (i32.shl (i32.const 1) (local.get $b_base))
                      (i32.shl (i32.const 1) (local.get $d_base))))))))
    (if (i32.ne (i32.popcnt (local.get $regs)) (i32.const 6))
      (then (return (i32.const 0))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_avg_matches
      (i32.add (global.get $loop_avg_matches) (i32.const 1)))
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0004))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (call $loop_generic_copy_emit_get))
      (then (return (i32.const 0))))

    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $loop_emit_avg
      (i32.const 0) (local.get $mask) (i32.const 0)
      (local.get $a_base) (local.get $ind) (local.get $scale) (local.get $a_disp) (i32.const 0)
      (local.get $b_base) (local.get $ind) (local.get $scale) (local.get $b_disp) (i32.const 0)
      (local.get $d_base) (local.get $ind) (local.get $scale) (local.get $d_disp) (i32.const 0)
      (local.get $ind) (i32.const -1) (i32.const 1) (i32.const 9))

    ;; Ordinary complete final iteration.
    (call $te (i32.const 389) (local.get $a))
    (call $te_raw (local.get $a_info)) (call $te_raw (local.get $a_disp))
    (call $te (i32.const 389) (local.get $b))
    (call $te_raw (local.get $b_info)) (call $te_raw (local.get $b_disp))
    (call $te (i32.const 7) (local.get $a)) (call $te_raw (local.get $mask))
    (call $te (i32.const 7) (local.get $b)) (call $te_raw (local.get $mask))
    (call $te (i32.const 12) (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $b)))
    (call $te (i32.const 53) (i32.or (local.get $a) (i32.const 0x10300)))
    (call $te (i32.const 420) (local.get $a))
    (call $te_raw (local.get $d_info)) (call $te_raw (local.get $d_disp))
    (call $te (i32.const 65) (local.get $ind))
    (call $te (i32.const 320) (local.get $branch_op))
    (call $te_raw (local.get $fall)) (call $te_raw (local.get $back))
    (i32.const 1))

  ;; Advancing-cursor floor average used by Winamp AVS and VirtualDub-shaped
  ;; renderers: shift both lanes, apply one common mask, then add.
  (func $loop_try_avg_shift_cursor
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $fn i32) (local $branch_op i32)
    (local $a i32) (local $b i32) (local $ind i32)
    (local $a_base i32) (local $b_base i32) (local $d_base i32)
    (local $a_disp i32) (local $b_disp i32) (local $d_disp i32)
    (local $mask i32) (local $fall i32) (local $back i32) (local $regs i32)

    (if (i32.ne (global.get $op_index_n) (i32.const 13))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 0)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or (i32.lt_u (local.get $fn) (i32.const 339))
                (i32.gt_u (local.get $fn) (i32.const 346)))
      (then (return (i32.const 0))))
    (local.set $a_base (i32.sub (local.get $fn) (i32.const 339)))
    (local.set $a (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $a_disp (i32.load offset=8 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 1)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or (i32.lt_u (local.get $fn) (i32.const 339))
                (i32.gt_u (local.get $fn) (i32.const 346)))
      (then (return (i32.const 0))))
    (local.set $b_base (i32.sub (local.get $fn) (i32.const 339)))
    (local.set $b (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $b_disp (i32.load offset=8 (local.get $p)))

    (local.set $p (call $loop_op_at (i32.const 2)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 53))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (local.get $a) (i32.const 0x10500))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 3)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 53))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (local.get $b) (i32.const 0x10500))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 4)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $mask (i32.load offset=8 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 5)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $b))
                  (i32.ne (i32.load offset=8 (local.get $p)) (local.get $mask))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 6)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 12))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $b))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 7)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or
          (i32.or (i32.lt_u (local.get $fn) (i32.const 347))
                  (i32.gt_u (local.get $fn) (i32.const 354)))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $d_base (i32.sub (local.get $fn) (i32.const 347)))
    (local.set $d_disp (i32.load offset=8 (local.get $p)))

    ;; Three cursor bumps by four bytes in stream order.
    (local.set $p (call $loop_op_at (i32.const 8)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a_base))
                  (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 9)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $b_base))
                  (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 10)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $d_base))
                  (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 11)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 65))
      (then (return (i32.const 0))))
    (local.set $ind (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 12)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 312))
      (then (return (i32.const 0))))
    (local.set $branch_op (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $fall (i32.load offset=8 (local.get $p)))
    (local.set $back (i32.load offset=12 (local.get $p)))

    (local.set $regs
      (i32.or (i32.shl (i32.const 1) (local.get $a))
        (i32.or (i32.shl (i32.const 1) (local.get $b))
          (i32.or (i32.shl (i32.const 1) (local.get $ind))
            (i32.or (i32.shl (i32.const 1) (local.get $a_base))
              (i32.or (i32.shl (i32.const 1) (local.get $b_base))
                      (i32.shl (i32.const 1) (local.get $d_base))))))))
    (if (i32.ne (i32.popcnt (local.get $regs)) (i32.const 6))
      (then (return (i32.const 0))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_avg_matches
      (i32.add (global.get $loop_avg_matches) (i32.const 1)))
    (if (i32.eqz (call $loop_generic_copy_emit_get))
      (then (return (i32.const 0))))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $loop_emit_avg
      (i32.const 1) (local.get $mask) (i32.const 0)
      (local.get $a_base) (i32.const -1) (i32.const 0) (local.get $a_disp) (i32.const 4)
      (local.get $b_base) (i32.const -1) (i32.const 0) (local.get $b_disp) (i32.const 4)
      (local.get $d_base) (i32.const -1) (i32.const 0) (local.get $d_disp) (i32.const 4)
      (local.get $ind) (i32.const -1) (i32.const 0) (i32.const 13))

    (call $te (i32.add (i32.const 339) (local.get $a_base)) (local.get $a))
    (call $te_raw (local.get $a_disp))
    (call $te (i32.add (i32.const 339) (local.get $b_base)) (local.get $b))
    (call $te_raw (local.get $b_disp))
    (call $te (i32.const 53) (i32.or (local.get $a) (i32.const 0x10500)))
    (call $te (i32.const 53) (i32.or (local.get $b) (i32.const 0x10500)))
    (call $te (i32.const 7) (local.get $a)) (call $te_raw (local.get $mask))
    (call $te (i32.const 7) (local.get $b)) (call $te_raw (local.get $mask))
    (call $te (i32.const 12) (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $b)))
    (call $te (i32.add (i32.const 347) (local.get $d_base)) (local.get $a))
    (call $te_raw (local.get $d_disp))
    (call $te (i32.const 3) (local.get $a_base)) (call $te_raw (i32.const 4))
    (call $te (i32.const 3) (local.get $b_base)) (call $te_raw (i32.const 4))
    (call $te (i32.const 3) (local.get $d_base)) (call $te_raw (i32.const 4))
    (call $te (i32.const 65) (local.get $ind))
    (call $te (i32.const 312) (local.get $branch_op))
    (call $te_raw (local.get $fall)) (call $te_raw (local.get $back))
    (i32.const 1))

  ;; Rounded packed average used by SDL/Smacker-shaped renderers. Preserve the
  ;; correction term in a third data register before shifting the two sources:
  ;;
  ;;   mov A,[baseA] / mov B,[baseB] / mov R,A / and R,B / and R,round_mask
  ;;   shr A,1 / shr B,1 / and A,mask / and B,mask
  ;;   add A,B / add A,R / mov [baseD],A
  ;;   add baseA,4 / add baseB,4 / add baseD,4 / dec count / jnz ^
  (func $loop_try_avg_round_cursor
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $fn i32) (local $branch_op i32)
    (local $a i32) (local $b i32) (local $round i32) (local $ind i32)
    (local $a_base i32) (local $b_base i32) (local $d_base i32)
    (local $a_disp i32) (local $b_disp i32) (local $d_disp i32)
    (local $mask i32) (local $round_mask i32)
    (local $fall i32) (local $back i32) (local $regs i32)

    (if (i32.ne (global.get $op_index_n) (i32.const 17))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 0)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or (i32.lt_u (local.get $fn) (i32.const 339))
                (i32.gt_u (local.get $fn) (i32.const 346)))
      (then (return (i32.const 0))))
    (local.set $a_base (i32.sub (local.get $fn) (i32.const 339)))
    (local.set $a (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $a_disp (i32.load offset=8 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 1)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or (i32.lt_u (local.get $fn) (i32.const 339))
                (i32.gt_u (local.get $fn) (i32.const 346)))
      (then (return (i32.const 0))))
    (local.set $b_base (i32.sub (local.get $fn) (i32.const 339)))
    (local.set $b (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $b_disp (i32.load offset=8 (local.get $p)))

    (local.set $p (call $loop_op_at (i32.const 2)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 11))
      (then (return (i32.const 0))))
    (local.set $round (i32.shr_u (load.field.memarg LoopOp operand (local.get $p)) (i32.const 4)))
    (if (i32.ne (load.field.memarg LoopOp operand (local.get $p))
          (i32.or (i32.shl (local.get $round) (i32.const 4)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 3)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 16))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (i32.shl (local.get $round) (i32.const 4)) (local.get $b))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 4)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $round)))
      (then (return (i32.const 0))))
    (local.set $round_mask (i32.load offset=8 (local.get $p)))

    (local.set $p (call $loop_op_at (i32.const 5)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 53))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (local.get $a) (i32.const 0x10500))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 6)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 53))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (local.get $b) (i32.const 0x10500))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 7)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $mask (i32.load offset=8 (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 8)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 7))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $b))
                  (i32.ne (i32.load offset=8 (local.get $p)) (local.get $mask))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 9)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 12))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $b))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 10)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 12))
                (i32.ne (load.field.memarg LoopOp operand (local.get $p))
                  (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $round))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 11)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or
          (i32.or (i32.lt_u (local.get $fn) (i32.const 347))
                  (i32.gt_u (local.get $fn) (i32.const 354)))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a)))
      (then (return (i32.const 0))))
    (local.set $d_base (i32.sub (local.get $fn) (i32.const 347)))
    (local.set $d_disp (i32.load offset=8 (local.get $p)))

    (local.set $p (call $loop_op_at (i32.const 12)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $a_base))
                  (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 13)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $b_base))
                  (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 14)))
    (if (i32.or (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $d_base))
                  (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))
    (local.set $p (call $loop_op_at (i32.const 15)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 65))
      (then (return (i32.const 0))))
    (local.set $ind (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $p (call $loop_op_at (i32.const 16)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 312))
      (then (return (i32.const 0))))
    (local.set $branch_op (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $fall (i32.load offset=8 (local.get $p)))
    (local.set $back (i32.load offset=12 (local.get $p)))

    ;; Seven distinct roles ensure neither data load nor cursor update changes
    ;; an address component or the private countdown used later in the body.
    (local.set $regs
      (i32.or (i32.shl (i32.const 1) (local.get $a))
        (i32.or (i32.shl (i32.const 1) (local.get $b))
          (i32.or (i32.shl (i32.const 1) (local.get $round))
            (i32.or (i32.shl (i32.const 1) (local.get $ind))
              (i32.or (i32.shl (i32.const 1) (local.get $a_base))
                (i32.or (i32.shl (i32.const 1) (local.get $b_base))
                        (i32.shl (i32.const 1) (local.get $d_base)))))))))
    (if (i32.ne (i32.popcnt (local.get $regs)) (i32.const 7))
      (then (return (i32.const 0))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_avg_matches
      (i32.add (global.get $loop_avg_matches) (i32.const 1)))
    (if (i32.eqz (call $loop_generic_copy_emit_get))
      (then (return (i32.const 0))))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $loop_emit_avg
      (i32.const 2) (local.get $mask) (local.get $round_mask)
      (local.get $a_base) (i32.const -1) (i32.const 0) (local.get $a_disp) (i32.const 4)
      (local.get $b_base) (i32.const -1) (i32.const 0) (local.get $b_disp) (i32.const 4)
      (local.get $d_base) (i32.const -1) (i32.const 0) (local.get $d_disp) (i32.const 4)
      (local.get $ind) (i32.const -1) (i32.const 0) (i32.const 17))

    ;; Retain the complete final iteration as ordinary threaded handlers.
    (call $te (i32.add (i32.const 339) (local.get $a_base)) (local.get $a))
    (call $te_raw (local.get $a_disp))
    (call $te (i32.add (i32.const 339) (local.get $b_base)) (local.get $b))
    (call $te_raw (local.get $b_disp))
    (call $te (i32.const 11)
      (i32.or (i32.shl (local.get $round) (i32.const 4)) (local.get $a)))
    (call $te (i32.const 16)
      (i32.or (i32.shl (local.get $round) (i32.const 4)) (local.get $b)))
    (call $te (i32.const 7) (local.get $round)) (call $te_raw (local.get $round_mask))
    (call $te (i32.const 53) (i32.or (local.get $a) (i32.const 0x10500)))
    (call $te (i32.const 53) (i32.or (local.get $b) (i32.const 0x10500)))
    (call $te (i32.const 7) (local.get $a)) (call $te_raw (local.get $mask))
    (call $te (i32.const 7) (local.get $b)) (call $te_raw (local.get $mask))
    (call $te (i32.const 12)
      (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $b)))
    (call $te (i32.const 12)
      (i32.or (i32.shl (local.get $a) (i32.const 4)) (local.get $round)))
    (call $te (i32.add (i32.const 347) (local.get $d_base)) (local.get $a))
    (call $te_raw (local.get $d_disp))
    (call $te (i32.const 3) (local.get $a_base)) (call $te_raw (i32.const 4))
    (call $te (i32.const 3) (local.get $b_base)) (call $te_raw (i32.const 4))
    (call $te (i32.const 3) (local.get $d_base)) (call $te_raw (i32.const 4))
    (call $te (i32.const 65) (local.get $ind))
    (call $te (i32.const 312) (local.get $branch_op))
    (call $te_raw (local.get $fall)) (call $te_raw (local.get $back))
    (i32.const 1))

  ;; ------------------------------------------------------------------
  ;; Bounded dword COPY_RUN
  ;; ------------------------------------------------------------------
  ;; Abe's dominant row copier at 0x00496c31 is the six-op self-loop:
  ;;
  ;;   mov scratch,[src] / add src,4 / mov [dst],scratch / add dst,4
  ;;   cmp dst,bound / jb ^
  ;;
  ;; The bytes moved are the same as a forward byte stream whenever the source
  ;; and destination spans do not overlap. Reuse scalar H419 mode 0 with a
  ;; private, bound-derived byte count (ctr_kind=2), src/dst byte strides, and
  ;; a four-byte rounding quantum. H419 retains complete-dword budget
  ;; boundaries and takes an ordinary dword fallback for overlap. The final
  ;; scratch load and original CMP/JB remain ordinary threaded ops, so their
  ;; architectural register and flag results need no reimplementation here.
  ;;
  ;; This recognizer is exact in role order but register/displacement generic.
  ;; All four registers must differ: otherwise one of the cursor bumps or the
  ;; load would change a later address/bound in the same original iteration.
  (func $loop_try_copy32_bounded
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $fn i32) (local $op i32)
    (local $src i32) (local $dst i32) (local $scratch i32) (local $bound i32)
    (local $src_disp i32) (local $dst_disp i32)
    (local $fall i32) (local $back i32) (local $mask i32)

    (if (i32.ne (global.get $op_index_n) (i32.const 6))
      (then (return (i32.const 0))))

    ;; mov scratch,[src+disp]
    (local.set $p (call $loop_op_at (i32.const 0)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or (i32.lt_u (local.get $fn) (i32.const 339))
                (i32.gt_u (local.get $fn) (i32.const 346)))
      (then (return (i32.const 0))))
    (local.set $src (i32.sub (local.get $fn) (i32.const 339)))
    (local.set $scratch (load.field.memarg LoopOp operand (local.get $p)))
    (local.set $src_disp (i32.load offset=8 (local.get $p)))

    ;; add src,4
    (local.set $p (call $loop_op_at (i32.const 1)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or
            (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $src))
            (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))

    ;; mov [dst+disp],scratch
    (local.set $p (call $loop_op_at (i32.const 2)))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.or (i32.lt_u (local.get $fn) (i32.const 347))
                (i32.gt_u (local.get $fn) (i32.const 354)))
      (then (return (i32.const 0))))
    (local.set $dst (i32.sub (local.get $fn) (i32.const 347)))
    (if (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $scratch))
      (then (return (i32.const 0))))
    (local.set $dst_disp (i32.load offset=8 (local.get $p)))

    ;; add dst,4
    (local.set $p (call $loop_op_at (i32.const 3)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 3))
          (i32.or
            (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (local.get $dst))
            (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 4))))
      (then (return (i32.const 0))))

    ;; cmp dst,bound / jb back
    (local.set $p (call $loop_op_at (i32.const 4)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 19))
      (then (return (i32.const 0))))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.ne (i32.shr_u (local.get $op) (i32.const 4)) (local.get $dst))
      (then (return (i32.const 0))))
    (local.set $bound (i32.and (local.get $op) (i32.const 0xF)))
    (local.set $p (call $loop_op_at (i32.const 5)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 309))
      (then (return (i32.const 0))))
    (local.set $fall (i32.load offset=8 (local.get $p)))
    (local.set $back (i32.load offset=12 (local.get $p)))

    (local.set $mask
      (i32.or (i32.shl (i32.const 1) (local.get $src))
        (i32.or (i32.shl (i32.const 1) (local.get $dst))
          (i32.or (i32.shl (i32.const 1) (local.get $scratch))
                  (i32.shl (i32.const 1) (local.get $bound))))))
    ;; Four distinct registers set exactly four bits.
    (if (i32.ne (i32.popcnt (local.get $mask)) (i32.const 4))
      (then (return (i32.const 0))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $loop_copy32_matches
      (i32.add (global.get $loop_copy32_matches) (i32.const 1)))
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0003))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (call $loop_generic_copy_emit_get))
      (then (return (i32.const 0))))

    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_COPY) (i32.const 0))
    (call $te_raw (local.get $src))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $src_disp))
    (call $te_raw (local.get $dst))
    (call $te_raw (i32.const 1))
    (call $te_raw (local.get $dst_disp))
    (call $te_raw (i32.const -1))            ;; no byte scratch publication
    (call $te_raw (i32.const 2))             ;; private bound-derived counter
    (call $te_raw (local.get $bound))
    (call $te_raw (i32.const 4))             ;; byte-count rounding quantum
    (call $te_raw (i32.const -1))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $back))
    (call $te_raw (i32.const 6))             ;; original ops per dword

    ;; Reconstruct the final full-width scratch value from the last destination
    ;; dword, then retain the exact terminator. Reading the destination (rather
    ;; than the possibly overwritten source) also preserves overlap semantics.
    (call $te (i32.add (i32.const 339) (local.get $dst)) (local.get $scratch))
    (call $te_raw (i32.sub (local.get $dst_disp) (i32.const 4)))
    (call $te (i32.const 19)
      (i32.or (i32.shl (local.get $dst) (i32.const 4)) (local.get $bound)))
    (call $te (i32.const 309) (load.field.memarg LoopOp operand (local.get $p)))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $back))
    (i32.const 1))

  ;; ------------------------------------------------------------------
  ;; COPY_RUN
  ;; ------------------------------------------------------------------
  ;;   dst[i] = src[i] for a counted run -- the byte-at-a-time memcpy every
  ;;   unpacker open-codes. Total Annihilation's is at 0x497948:
  ;;
  ;;     mov cl,[edx] / inc edx / mov [eax],cl / inc eax / dec [esp+d] / jnz ^
  ;;
  ;;   That single block is 8.7% of all block entries and 6.8% of all handler
  ;;   dispatches in a 3000-batch run, and today it is declined twice over: it
  ;;   is one op short of LUT_RUN's seven-op floor, and its trip counter lives
  ;;   on the stack rather than in a register. Both are accidents of LUT_RUN's
  ;;   shape, not of the idiom.
  ;;
  ;; Two cursors, two strides, two displacements, one byte register passing
  ;; through unchanged, and a counter in either a register or memory. The
  ;; source and destination bases must differ -- a copy through one cursor is
  ;; a different loop, and would alias.
  ;;
  ;; Parameter block:
  ;;   0 src_reg  1 src_stride  2 src_disp
  ;;   3 dst_reg  4 dst_stride  5 dst_disp
  ;;   6 byte_reg 7 ctr_kind (0 reg, 1 mem, 2 cursor bound)
  ;;   8 ctr_loc  9 ctr_disp
  ;;  10 ctr_step 11 fall_eip  12 back_eip  13 steps_per_iter
  ;;
  ;; Every form executes against a private local remaining count. Kinds 0/1
  ;; mirror that count into the architectural counter the guest loop updates.
  ;; Kind 2 instead derives byte count by rounding (bound-dst) up to a quantum,
  ;; where ctr_loc is the bound register and ctr_disp is that byte quantum; it has
  ;; no architectural counter to publish and continues into suffix ops.
  (global $LOOP_SUPEROP_COPY i32 (i32.const 419))

  (func $loop_try_copy (param $start_eip i32) (param $tstart i32) (result i32)
    (local $i i32) (local $n i32) (local $p i32) (local $fn i32) (local $op i32)
    (local $role i32) (local $reg i32) (local $step i32)
    (local $ld_base i32) (local $ld_reg i32) (local $ld_disp i32) (local $ld_idx i32) (local $ld_cnt i32)
    (local $st_base i32) (local $st_reg i32) (local $st_disp i32) (local $st_idx i32) (local $st_cnt i32)
    (local $mem_base i32) (local $mem_disp i32) (local $mem_step i32) (local $mem_idx i32) (local $mem_cnt i32)
    (local $addi_cnt i32) (local $written i32)
    (local $src_stride i32) (local $src_idx i32) (local $src_cnt i32)
    (local $dst_stride i32) (local $dst_idx i32) (local $dst_cnt i32)
    (local $ctr_kind i32) (local $ctr_loc i32) (local $ctr_disp i32)
    (local $ctr_step i32) (local $ctr_idx i32) (local $ctr_cnt i32)
    (local $fall i32)

    (local.set $n (global.get $op_index_n))
    ;; load / bump / store / bump / count / branch is the floor; anything
    ;; longer than a dozen ops is doing more than copying.
    (if (i32.lt_u (local.get $n) (i32.const 5)) (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $n) (i32.const 12)) (then (return (i32.const 0))))

    ;; ---- pass 1: roles ----
    ;; Only the five roles this idiom is made of are tolerated. A ZERO, a
    ;; MIRROR or an indexed load means the body is computing something, and
    ;; whatever it is, it is not this.
    (local.set $i (i32.const 0))
    (block $p1_done
      (loop $p1
        (br_if $p1_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (local.set $fn (load.field LoopOp handler (local.get $p)))
        (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
        (local.set $role (call $loop_role (local.get $fn) (local.get $op)))

        (if (i32.eq (local.get $role) (global.get $LR_LOAD8))
          (then
            (local.set $ld_cnt (i32.add (local.get $ld_cnt) (i32.const 1)))
            (local.set $ld_base (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $ld_reg (i32.shr_u (local.get $op) (i32.const 4)))
            (local.set $ld_disp (i32.load offset=8 (local.get $p)))
            (local.set $ld_idx (local.get $i))
            (local.set $written (i32.or (local.get $written)
              (i32.shl (i32.const 1) (i32.and (local.get $ld_reg) (i32.const 3))))))
          (else (if (i32.eq (local.get $role) (global.get $LR_STORE8))
            (then
              (local.set $st_cnt (i32.add (local.get $st_cnt) (i32.const 1)))
              (local.set $st_base (i32.and (local.get $op) (i32.const 0xF)))
              (local.set $st_reg (i32.shr_u (local.get $op) (i32.const 4)))
              (local.set $st_disp (i32.load offset=8 (local.get $p)))
              (local.set $st_idx (local.get $i)))
          (else (if (i32.eq (local.get $role) (global.get $LR_ADDI))
            (then
              (local.set $addi_cnt (i32.add (local.get $addi_cnt) (i32.const 1)))
              (local.set $written (i32.or (local.get $written)
                (i32.shl (i32.const 1) (i32.and (local.get $op) (i32.const 0xF))))))
          (else (if (i32.eq (local.get $role) (global.get $LR_MEMCTR))
            (then
              (local.set $mem_cnt (i32.add (local.get $mem_cnt) (i32.const 1)))
              (local.set $mem_base (i32.and (local.get $op) (i32.const 0xF)))
              (local.set $mem_disp (i32.load offset=8 (local.get $p)))
              (local.set $mem_step (select (i32.const 1) (i32.const -1)
                (i32.eqz (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))))
              (local.set $mem_idx (local.get $i)))
          (else (if (i32.eq (local.get $role) (global.get $LR_JCC))
            (then
              (if (i32.ne (local.get $i) (i32.sub (local.get $n) (i32.const 1)))
                (then (return (i32.const 0)))))
            (else (return (i32.const 0))))))))))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $p1)))

    ;; ---- pass 2: the predicate ----
    (if (i32.ne (local.get $ld_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $st_cnt) (i32.const 1)) (then (return (i32.const 0))))
    ;; The byte read is the byte written, untouched in between.
    (if (i32.ne (local.get $ld_reg) (local.get $st_reg)) (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $ld_idx) (local.get $st_idx)) (then (return (i32.const 0))))
    ;; One cursor for the source, a different one for the destination.
    (if (i32.eq (local.get $ld_base) (local.get $st_base)) (then (return (i32.const 0))))
    ;; The byte register's parent must not be a cursor, or the load moves the
    ;; pointer it just read through.
    (if (i32.eq (i32.and (local.get $ld_reg) (i32.const 3)) (local.get $ld_base))
      (then (return (i32.const 0))))
    (if (i32.eq (i32.and (local.get $ld_reg) (i32.const 3)) (local.get $st_base))
      (then (return (i32.const 0))))

    ;; Sort the increments: one steps the source, one the destination, and a
    ;; third (if there is no memory counter) is the trip count.
    (local.set $i (i32.const 0))
    (block $p2_done
      (loop $p2
        (br_if $p2_done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (local.set $fn (load.field LoopOp handler (local.get $p)))
        (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
        (if (i32.eq (call $loop_role (local.get $fn) (local.get $op))
                    (global.get $LR_ADDI))
          (then
            (local.set $reg (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $step
              (select (i32.const 1) (i32.const -1) (i32.eq (local.get $fn) (i32.const 64))))
            (if (i32.eq (local.get $reg) (local.get $ld_base))
              (then
                (local.set $src_cnt (i32.add (local.get $src_cnt) (i32.const 1)))
                (local.set $src_stride (local.get $step))
                (local.set $src_idx (local.get $i)))
              (else (if (i32.eq (local.get $reg) (local.get $st_base))
                (then
                  (local.set $dst_cnt (i32.add (local.get $dst_cnt) (i32.const 1)))
                  (local.set $dst_stride (local.get $step))
                  (local.set $dst_idx (local.get $i)))
                (else
                  (local.set $ctr_cnt (i32.add (local.get $ctr_cnt) (i32.const 1)))
                  (local.set $ctr_loc (local.get $reg))
                  (local.set $ctr_step (local.get $step))
                  (local.set $ctr_idx (local.get $i))))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $p2)))

    ;; Both cursors stepped exactly once; no fourth increment.
    (if (i32.ne (local.get $src_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $dst_cnt) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (i32.add (local.get $ctr_cnt) (local.get $mem_cnt)) (i32.const 1))
      (then (return (i32.const 0))))
    (if (i32.ne (local.get $addi_cnt)
                (i32.add (i32.const 2) (local.get $ctr_cnt)))
      (then (return (i32.const 0))))

    ;; A counter in memory needs a loop-invariant address, or it is not one
    ;; counter but a walk over several.
    (if (local.get $mem_cnt)
      (then
        (if (i32.and (local.get $written)
              (i32.shl (i32.const 1) (local.get $mem_base)))
          (then (return (i32.const 0))))
        (local.set $ctr_kind (i32.const 1))
        (local.set $ctr_loc (local.get $mem_base))
        (local.set $ctr_disp (local.get $mem_disp))
        (local.set $ctr_step (local.get $mem_step))
        (local.set $ctr_idx (local.get $mem_idx))))

    ;; Only the count-down-to-zero form: the branch reads the counter's flags,
    ;; so the counter has to be the last thing that set them.
    (local.set $p (call $loop_op_at (i32.sub (local.get $n) (i32.const 1))))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 312)) (then (return (i32.const 0))))
    (if (i32.ne (local.get $ctr_idx) (i32.sub (local.get $n) (i32.const 2)))
      (then (return (i32.const 0))))

    ;; Fold the cursor bumps into the displacements. The super-op bumps AFTER
    ;; the access, so an access the original performed after its own bump saw
    ;; a cursor one stride ahead.
    (if (i32.lt_u (local.get $src_idx) (local.get $ld_idx))
      (then (local.set $ld_disp (i32.add (local.get $ld_disp) (local.get $src_stride)))))
    (if (i32.lt_u (local.get $dst_idx) (local.get $st_idx))
      (then (local.set $st_disp (i32.add (local.get $st_disp) (local.get $dst_stride)))))

    ;; ---- emit ----
    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    ;; Marker 0x100B0002 = COPY_RUN, then the entry EIP. See the LUT_RUN one.
    (if (global.get $loop_trace)
      (then
        (call $host_log_i32 (i32.const 0x100B0002))
        (call $host_log_i32 (local.get $start_eip))))
    (if (i32.eqz (call $loop_generic_copy_emit_get)) (then (return (i32.const 0))))

    (local.set $fall (i32.load offset=8
      (call $loop_op_at (i32.sub (local.get $n) (i32.const 1)))))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_COPY) (i32.const 0))
    (call $te_raw (local.get $ld_base))
    (call $te_raw (local.get $src_stride))
    (call $te_raw (local.get $ld_disp))
    (call $te_raw (local.get $st_base))
    (call $te_raw (local.get $dst_stride))
    (call $te_raw (local.get $st_disp))
    (call $te_raw (local.get $ld_reg))
    (call $te_raw (local.get $ctr_kind))
    (call $te_raw (local.get $ctr_loc))
    (call $te_raw (local.get $ctr_disp))
    (call $te_raw (local.get $ctr_step))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $start_eip))
    (call $te_raw (local.get $n))
    (i32.const 1))

  ;; Bytes a cursor can still touch before it leaves the 4 KB page it sits in,
  ;; counting the byte under it. $g2w is affine within a map record, and a
  ;; sparse reservation committed in pieces gets one record per commit, so a
  ;; page is the largest span whose guest->WASM delta is guaranteed constant.
  ;; This is the same invariant $gl32 relies on when it skips its cross-page
  ;; gather. LUT16 additionally uses +/-2 destination strides.
  (func $copy_page_room (param $ga i32) (param $stride i32) (result i32)
    (local $off i32)
    (local.set $off (i32.and (local.get $ga) (i32.const 0xFFF)))
    (if (i32.gt_s (local.get $stride) (i32.const 0))
      (then
        (return
          (i32.add
            (i32.div_u (i32.sub (i32.const 0xFFF) (local.get $off))
                       (local.get $stride))
            (i32.const 1)))))
    (i32.add
      (i32.div_u (local.get $off) (i32.sub (i32.const 0) (local.get $stride)))
      (i32.const 1)))

  ;; Fixed descriptor selected by H419 operand bit 31:
  ;;
  ;;   add ebx,ebx / jae tail
  ;;   movq mm0..3,[esi+0/8/16/24]
  ;;   movq [edi+0/8/16/24],mm0..3
  ;; tail: add edi,eax / add esi,32 / dec edx / jnz back
  ;;
  ;; Both fast store strategies preload the complete source row into two v128
  ;; values. That is required for overlap-safe x86 semantics and because the
  ;; routine returns without EMMS: the final mm0..mm3 values are architecturally
  ;; observable. The bulk arm then deliberately rereads those bytes through
  ;; memory.copy; the benchmark decides whether its optimized memmove beats two
  ;; v128 stores despite that extra read.
  (func $th_mmx_mask_copy32 (param $op i32)
    (local $tp i32) (local $fall i32) (local $back i32)
    (local $mask i32) (local $pitch i32) (local $src i32) (local $dst i32)
    (local $count i32) (local $old_src i32) (local $old_count i32)
    (local $src_wa i32) (local $dst_wa i32)
    (local $v0 v128) (local $v1 v128)
    (local $q0 i64) (local $q1 i64) (local $q2 i64) (local $q3 i64)
    (local $charge i32) (local $cost i32) (local $copied i32)
    (local $iterations i32) (local $copy_count i32)

    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 8)))
    (local.set $fall (i32.load (local.get $tp)))
    (local.set $back (i32.load offset=4 (local.get $tp)))
    (local.set $mask (global.get $ebx))
    (local.set $pitch (global.get $eax))
    (local.set $src (global.get $esi))
    (local.set $dst (global.get $edi))
    (local.set $count (global.get $edx))
    (global.set $mmx_mask_copy_runs
      (i32.add (global.get $mmx_mask_copy_runs) (i32.const 1)))

    (block $done
      (loop $rows
        (local.set $old_src (local.get $src))
        (local.set $old_count (local.get $count))
        ;; ADD EBX,EBX; JAE selects the copy from the bit shifted into CF.
        (local.set $copied (i32.lt_s (local.get $mask) (i32.const 0)))
        (local.set $mask (i32.shl (local.get $mask) (i32.const 1)))
        (local.set $cost (select (i32.const 22) (i32.const 6) (local.get $copied)))

        (if (local.get $copied)
          (then
            (local.set $copy_count (i32.add (local.get $copy_count) (i32.const 1)))
            ;; A page-local translation is affine for the whole row. Sparse
            ;; commits and DIB backing are page-granular; anything crossing a
            ;; page or resolving to NULL uses the exact four MMX helpers below.
            (if (i32.and
                  (i32.le_u (i32.and (local.get $src) (i32.const 0xFFF)) (i32.const 0xFE0))
                  (i32.le_u (i32.and (local.get $dst) (i32.const 0xFFF)) (i32.const 0xFE0)))
              (then
                (local.set $src_wa (call $g2w (local.get $src)))
                (local.set $dst_wa (call $g2w (local.get $dst))))
              (else
                (local.set $src_wa (global.get $NULL_SENTINEL))
                (local.set $dst_wa (global.get $NULL_SENTINEL))))
            (if (i32.and
                  (i32.ne (local.get $src_wa) (global.get $NULL_SENTINEL))
                  (i32.ne (local.get $dst_wa) (global.get $NULL_SENTINEL)))
              (then
                ;; Preload before either store: this is also the MMX result.
                (local.set $v0 (v128.load (local.get $src_wa)))
                (local.set $v1 (v128.load offset=16 (local.get $src_wa)))
                (local.set $q0 (i64x2.extract_lane 0 (local.get $v0)))
                (local.set $q1 (i64x2.extract_lane 1 (local.get $v0)))
                (local.set $q2 (i64x2.extract_lane 0 (local.get $v1)))
                (local.set $q3 (i64x2.extract_lane 1 (local.get $v1)))
                (call $invalidate_code_write (local.get $dst) (i32.const 32))
                (if (global.get $mmx_mask_copy_use_bulk)
                  (then
                    (memory.copy (local.get $dst_wa) (local.get $src_wa) (i32.const 32)))
                  (else
                    (v128.store (local.get $dst_wa) (local.get $v0))
                    (v128.store offset=16 (local.get $dst_wa) (local.get $v1)))))
              (else
                ;; Load all four values before storing any, matching the eight
                ;; original MOVQs even for overlapping or split mappings.
                (local.set $q0 (call $mmx_load64 (local.get $src)))
                (local.set $q1 (call $mmx_load64
                  (i32.add (local.get $src) (i32.const 8))))
                (local.set $q2 (call $mmx_load64
                  (i32.add (local.get $src) (i32.const 16))))
                (local.set $q3 (call $mmx_load64
                  (i32.add (local.get $src) (i32.const 24))))
                (call $mmx_store64 (local.get $dst) (local.get $q0))
                (call $mmx_store64 (i32.add (local.get $dst) (i32.const 8)) (local.get $q1))
                (call $mmx_store64 (i32.add (local.get $dst) (i32.const 16)) (local.get $q2))
                (call $mmx_store64 (i32.add (local.get $dst) (i32.const 24)) (local.get $q3))))))

        ;; The tail executes for selected and transparent rows alike.
        (local.set $dst (i32.add (local.get $dst) (local.get $pitch)))
        (local.set $src (i32.add (local.get $src) (i32.const 32)))
        (local.set $count (i32.sub (local.get $count) (i32.const 1)))
        (local.set $iterations (i32.add (local.get $iterations) (i32.const 1)))
        (local.set $charge (i32.add (local.get $charge) (local.get $cost)))
        (br_if $done (i32.eqz (local.get $count)))
        ;; $next already charged one dispatch before entering H419. Stop after
        ;; the same iteration that would spend the remaining threaded budget.
        (br_if $done
          (i32.ge_u (i32.sub (local.get $charge) (i32.const 1))
                    (global.get $steps)))
        (br $rows)))

    (global.set $ebx (local.get $mask))
    (global.set $esi (local.get $src))
    (global.set $edi (local.get $dst))
    (global.set $edx (local.get $count))
    ;; DEC preserves the carry produced by the preceding ADD ESI,32.
    (call $set_flags_add (local.get $old_src) (i32.const 32) (local.get $src))
    (call $set_flags_dec (local.get $old_count) (local.get $count))
    (if (local.get $copy_count)
      (then
        (call $mmx_set (i32.const 0) (local.get $q0))
        (call $mmx_set (i32.const 1) (local.get $q1))
        (call $mmx_set (i32.const 2) (local.get $q2))
        (call $mmx_set (i32.const 3) (local.get $q3))))
    (global.set $mmx_exec_count
      (i32.add (global.get $mmx_exec_count)
        (i32.mul (local.get $copy_count) (i32.const 8))))
    (global.set $mmx_mask_copy_rows
      (i64.add (global.get $mmx_mask_copy_rows) (i64.extend_i32_u (local.get $iterations))))
    (global.set $mmx_mask_copy_bytes
      (i64.add (global.get $mmx_mask_copy_bytes)
        (i64.extend_i32_u
          (i32.mul (local.get $copy_count) (i32.const 32)))))
    (global.set $steps
      (i32.sub (global.get $steps) (i32.sub (local.get $charge) (i32.const 1))))
    (global.set $eip
      (select (local.get $back) (local.get $fall) (i32.ne (local.get $count) (i32.const 0)))))

  ;; ------------------------------------------------------------------
  ;; 419: the COPY_RUN super-op.
  ;; ------------------------------------------------------------------
  ;; Same contract as 418: charge $steps at the body's op count so batch
  ;; granularity is unchanged, and republish $eip at the loop entry when the
  ;; budget runs out.
  ;;
  ;; A memory-resident counter is written back on every iteration rather than
  ;; once at exit. It is one extra store against six eliminated dispatches, and
  ;; it means the destination range is allowed to cover the counter's own
  ;; address -- which is not a shape worth reasoning about at match time.
  (func $th_copy_run (param $op i32)
    (local $src_reg i32) (local $src_stride i32) (local $src_disp i32)
    (local $dst_reg i32) (local $dst_stride i32) (local $dst_disp i32)
    (local $byte_reg i32) (local $ctr_kind i32) (local $ctr_loc i32)
    (local $ctr_disp i32) (local $ctr_step i32)
    (local $fall i32) (local $back i32) (local $cost i32)
    (local $src i32) (local $dst i32) (local $ctr i32) (local $old i32)
    (local $ctr_addr i32) (local $b i32) (local $tp i32) (local $store_ctr i32)
    (local $lo i32) (local $hi i32)
    (local $src_ga i32) (local $dst_ga i32) (local $src_wa i32) (local $dst_wa i32)
    (local $chunk i32) (local $trips i32) (local $allowed i32) (local $n i32)
    (local $bound i32) (local $round_quantum i32) (local $private_bytes i32)
    (local $private_limit i32) (local $private_groups i32)
    (local $src_end i32) (local $dst_end i32) (local $copy32_overlap i32)

    (if (i32.lt_s (local.get $op) (i32.const 0))
      (then (return_call $th_mmx_mask_copy32 (local.get $op))))

    ;; Fourteen $read_thread_word calls would be fourteen calls and fourteen
    ;; global round trips on every entry, and this loop's measured average trip
    ;; count is about four iterations -- the parameter block is not amortized
    ;; over a long run the way a bulk memcpy's would be. Read it as offsets off
    ;; one base and bump $ip once.
    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 56)))
    (local.set $src_reg    (i32.load          (local.get $tp)))
    (local.set $src_stride (i32.load offset=4  (local.get $tp)))
    (local.set $src_disp   (i32.load offset=8  (local.get $tp)))
    (local.set $dst_reg    (i32.load offset=12 (local.get $tp)))
    (local.set $dst_stride (i32.load offset=16 (local.get $tp)))
    (local.set $dst_disp   (i32.load offset=20 (local.get $tp)))
    (local.set $byte_reg   (i32.load offset=24 (local.get $tp)))
    (local.set $ctr_kind   (i32.load offset=28 (local.get $tp)))
    (local.set $ctr_loc    (i32.load offset=32 (local.get $tp)))
    (local.set $ctr_disp   (i32.load offset=36 (local.get $tp)))
    (local.set $ctr_step   (i32.load offset=40 (local.get $tp)))
    (local.set $fall       (i32.load offset=44 (local.get $tp)))
    (local.set $back       (i32.load offset=48 (local.get $tp)))
    (local.set $cost       (i32.load offset=52 (local.get $tp)))

    (local.set $src (call $get_reg (local.get $src_reg)))
    (local.set $dst (call $get_reg (local.get $dst_reg)))
    (if (i32.eq (local.get $ctr_kind) (i32.const 2))
      (then
        (local.set $round_quantum (local.get $ctr_disp))
        (local.set $bound (call $get_reg (local.get $ctr_loc)))
        ;; The original is do-while. At/above the bound it still performs one
        ;; element; below it, round the unsigned distance up to a whole element.
        ;; A near-4GB distance would overflow the round-up, so keep the safe
        ;; one-element progress form for that nonsensical mapping.
        (if (i32.and
              (i32.lt_u (local.get $dst) (local.get $bound))
              (i32.le_u (i32.sub (local.get $bound) (local.get $dst))
                        (i32.sub (i32.const -1)
                          (i32.sub (local.get $round_quantum) (i32.const 1)))))
          (then
            (local.set $ctr
              (i32.mul
                (i32.div_u
                  (i32.add (i32.sub (local.get $bound) (local.get $dst))
                    (i32.sub (local.get $round_quantum) (i32.const 1)))
                  (local.get $round_quantum))
                (local.get $round_quantum))))
          (else (local.set $ctr (local.get $round_quantum))))

        ;; Budget only at complete guest-element boundaries. The suffix owns
        ;; the final scratch/CMP/Jcc, so reserve its three threaded ops in the
        ;; accounting performed at exit below.
        (local.set $allowed
          (i32.div_u
            (i32.add
              (select (global.get $steps) (i32.const 0)
                (i32.gt_s (global.get $steps) (i32.const 0)))
              (i32.sub (local.get $cost) (i32.const 1)))
            (local.get $cost)))
        (if (i32.eqz (local.get $allowed))
          (then (local.set $allowed (i32.const 1))))
        (local.set $private_limit
          (i32.mul (local.get $allowed) (local.get $round_quantum)))
        (if (i32.gt_u (local.get $private_limit) (local.get $ctr))
          (then (local.set $private_limit (local.get $ctr))))

        ;; Byte-forward copy and dword-forward copy disagree for sub-dword
        ;; overlap. Use the shared byte kernel only for proved-disjoint spans;
        ;; the overlapping arm below executes one original-width load/store.
        (local.set $src_ga (i32.add (local.get $src) (local.get $src_disp)))
        (local.set $dst_ga (i32.add (local.get $dst) (local.get $dst_disp)))
        (local.set $src_end (i32.add (local.get $src_ga) (local.get $ctr)))
        (local.set $dst_end (i32.add (local.get $dst_ga) (local.get $ctr)))
        (local.set $copy32_overlap
          (i32.or
            (i32.or (i32.lt_u (local.get $src_end) (local.get $src_ga))
                    (i32.lt_u (local.get $dst_end) (local.get $dst_ga)))
            (i32.and (i32.lt_u (local.get $src_ga) (local.get $dst_end))
                     (i32.lt_u (local.get $dst_ga) (local.get $src_end)))))
        (global.set $loop_copy32_runs
          (i32.add (global.get $loop_copy32_runs) (i32.const 1))))
      (else (if (i32.eq (local.get $ctr_kind) (i32.const 1))
        (then
        (local.set $ctr_addr
          (i32.add (call $get_reg (local.get $ctr_loc)) (local.get $ctr_disp)))
        (local.set $ctr (call $gl32 (local.get $ctr_addr))))
        (else (local.set $ctr (call $get_reg (local.get $ctr_loc)))))))

    ;; A memory counter has to be written back per iteration in general: the
    ;; destination range is allowed to cover the counter's own address, and a
    ;; deferred write would then lose whatever the copy put there. But that is
    ;; a pathological shape, and it is cheap to rule out here, where the run
    ;; length is known: at most $ctr bytes starting at the destination cursor.
    ;; When the counter sits outside that span, write it once at exit.
    (local.set $store_ctr
      (select (i32.const 1) (i32.const 0)
        (i32.eq (local.get $ctr_kind) (i32.const 1))))
    (if (i32.and (i32.eq (local.get $ctr_kind) (i32.const 1))
                 (i32.and (i32.eq (local.get $ctr_step) (i32.const -1))
                          (i32.gt_s (local.get $ctr) (i32.const 0))))
      (then
        (local.set $lo (i32.add (local.get $dst) (local.get $dst_disp)))
        (local.set $hi (local.get $lo))
        (if (i32.eq (local.get $dst_stride) (i32.const 1))
          (then (local.set $hi (i32.add (local.get $lo)
                  (i32.sub (local.get $ctr) (i32.const 1)))))
          (else (local.set $lo (i32.sub (local.get $hi)
                  (i32.sub (local.get $ctr) (i32.const 1))))))
        ;; An address range that wrapped tells us nothing; leave it per-iteration.
        (if (i32.le_u (local.get $lo) (local.get $hi))
          (then
            (if (i32.or
                  (i32.lt_u (i32.add (local.get $ctr_addr) (i32.const 3)) (local.get $lo))
                  (i32.gt_u (local.get $ctr_addr) (local.get $hi)))
              (then (local.set $store_ctr (i32.const 0))))))))

    ;; The run is copied a page-chunk at a time rather than a byte at a time.
    ;; Per byte, $gl8 was a call plus a page-cache probe and $gs8 was a call
    ;; plus a full $g2w plus a code-page test; none of that can change inside a
    ;; chunk. Guest mappings are only created by API calls (VirtualAlloc, file
    ;; mapping, DLL load), no guest code runs while this handler is on the
    ;; stack, and map records are append-only -- so a translation resolved at
    ;; chunk entry stays valid for the whole chunk. What is left in the inner
    ;; loop is two raw accesses and two pointer bumps.
    (block $exit
      (loop $outer
        (local.set $src_ga (i32.add (local.get $src) (local.get $src_disp)))
        (local.set $dst_ga (i32.add (local.get $dst) (local.get $dst_disp)))

        ;; Iterations left before the counter reaches zero. The loop is
        ;; do-while, so a counter that is already zero runs the whole wrap.
        (local.set $trips
          (select (local.get $ctr)
                  (i32.sub (i32.const 0) (local.get $ctr))
                  (i32.eq (local.get $ctr_step) (i32.const -1))))
        (if (i32.eqz (local.get $trips))
          (then (local.set $trips (i32.const -1))))

        ;; Iterations the step budget still pays for. The original exits after
        ;; the first iteration that drives $steps to zero or below, so this is
        ;; a ceiling, and a budget already spent still buys one iteration.
        (if (i32.eq (local.get $ctr_kind) (i32.const 2))
          (then
            (local.set $allowed
              (i32.sub (local.get $private_limit) (local.get $private_bytes))))
          (else
            (local.set $allowed
              (i32.div_u
                (i32.add
                  (select (global.get $steps) (i32.const 0)
                          (i32.gt_s (global.get $steps) (i32.const 0)))
                  (i32.sub (local.get $cost) (i32.const 1)))
                (local.get $cost)))
            (if (i32.eqz (local.get $allowed))
              (then (local.set $allowed (i32.const 1))))))

        (local.set $chunk
          (select (local.get $trips) (local.get $allowed)
                  (i32.lt_u (local.get $trips) (local.get $allowed))))
        (local.set $n (call $copy_page_room (local.get $src_ga) (local.get $src_stride)))
        (local.set $chunk
          (select (local.get $n) (local.get $chunk)
                  (i32.lt_u (local.get $n) (local.get $chunk))))
        (local.set $n (call $copy_page_room (local.get $dst_ga) (local.get $dst_stride)))
        (local.set $chunk
          (select (local.get $n) (local.get $chunk)
                  (i32.lt_u (local.get $n) (local.get $chunk))))

        (local.set $src_wa (call $g2w (local.get $src_ga)))
        (local.set $dst_wa (call $g2w (local.get $dst_ga)))
        ;; An unmapped cursor resolves to the four-byte null sentinel, which is
        ;; not a page and must never be walked; and a counter that has to be
        ;; published every step has no chunked form. One iteration per chunk is
        ;; exactly the old per-byte behaviour in both cases.
        (if (i32.or
              (i32.ne (local.get $store_ctr) (i32.const 0))
              (i32.or
                (i32.eq (local.get $src_wa) (global.get $NULL_SENTINEL))
                (i32.eq (local.get $dst_wa) (global.get $NULL_SENTINEL))))
          (then (local.set $chunk (i32.const 1))))

        ;; One code-page test for the whole chunk. The chunk cannot leave the
        ;; destination page and nothing executes between its first and last
        ;; store, so invalidating up front is what invalidating per byte did.
        ;;
        ;; The destination stride can be negative and larger than one byte, so
        ;; the exact extent is not simply [dst_ga, dst_ga+chunk). Since the
        ;; chunk is known to stay inside one page, name the page instead: that
        ;; is what this call has always meant, and $invalidate_code_range turns
        ;; a span this wide into the page drop the old $invalidate_page did.
        (if (i32.and
              (i32.eq (local.get $ctr_kind) (i32.const 2))
              (i32.or (local.get $copy32_overlap)
                (i32.or
                  (i32.eq (local.get $src_wa) (global.get $NULL_SENTINEL))
                  (i32.eq (local.get $dst_wa) (global.get $NULL_SENTINEL)))))
          (then
            ;; Preserve the original load-before-store width on overlap and
            ;; on the unmapped four-byte sentinel. This arm completes exactly
            ;; one guest iteration even when either dword crosses a page.
            (local.set $chunk (local.get $round_quantum))
            (local.set $b (call $gl32 (local.get $src_ga)))
            (call $gs32 (local.get $dst_ga) (local.get $b)))
          (else
            (call $invalidate_code_write
              (i32.and (local.get $dst_ga) (i32.const 0xFFFFF000)) (i32.const 4096))

            (local.set $n (local.get $chunk))
            (loop $inner
              (local.set $b (i32.load8_u (local.get $src_wa)))
              (i32.store8 (local.get $dst_wa) (local.get $b))
              (local.set $src_wa (i32.add (local.get $src_wa) (local.get $src_stride)))
              (local.set $dst_wa (i32.add (local.get $dst_wa) (local.get $dst_stride)))
              (local.set $n (i32.sub (local.get $n) (i32.const 1)))
              (br_if $inner (local.get $n)))))

        (local.set $src
          (i32.add (local.get $src) (i32.mul (local.get $chunk) (local.get $src_stride))))
        (local.set $dst
          (i32.add (local.get $dst) (i32.mul (local.get $chunk) (local.get $dst_stride))))
        (local.set $ctr
          (i32.add (local.get $ctr) (i32.mul (local.get $chunk) (local.get $ctr_step))))
        ;; The flags the terminator reads belong to the last iteration only.
        (local.set $old (i32.sub (local.get $ctr) (local.get $ctr_step)))
        (if (local.get $store_ctr)
          (then (call $gs32 (local.get $ctr_addr) (local.get $ctr))))
        (if (i32.eq (local.get $ctr_kind) (i32.const 2))
          (then
            (local.set $private_bytes
              (i32.add (local.get $private_bytes) (local.get $chunk))))
          (else
            (global.set $steps
              (i32.sub (global.get $steps)
                (i32.mul (local.get $chunk) (local.get $cost))))))
        (br_if $exit (i32.eqz (local.get $ctr)))
        (if (i32.eq (local.get $ctr_kind) (i32.const 2))
          (then
            (br_if $exit
              (i32.ge_u (local.get $private_bytes) (local.get $private_limit))))
          (else
            (br_if $exit (i32.le_s (global.get $steps) (i32.const 0)))))
        (br $outer)))

    (call $set_reg (local.get $src_reg) (local.get $src))
    (call $set_reg (local.get $dst_reg) (local.get $dst))
    (if (i32.ge_s (local.get $byte_reg) (i32.const 0))
      (then (call $set_reg8 (local.get $byte_reg) (local.get $b))))
    (if (i32.eqz (local.get $ctr_kind))
      (then (call $set_reg (local.get $ctr_loc) (local.get $ctr)))
      (else (if (i32.and
                  (i32.eq (local.get $ctr_kind) (i32.const 1))
                  (i32.eqz (local.get $store_ctr)))
        (then (call $gs32 (local.get $ctr_addr) (local.get $ctr))))))
    (if (i32.eq (local.get $ctr_kind) (i32.const 2))
      (then
        (global.set $loop_copy32_bytes
          (i64.add (global.get $loop_copy32_bytes)
            (i64.extend_i32_u (local.get $private_bytes))))
        (local.set $private_groups
          (i32.div_u (local.get $private_bytes) (local.get $round_quantum)))
        ;; $next already charged H419 and will charge the retained scratch
        ;; load, CMP and Jcc. Charge the remaining original ops for N complete
        ;; six-op guest iterations, then account for the N-1 folded backedges.
        (if (i32.gt_u
              (i32.mul (local.get $private_groups) (local.get $cost))
              (i32.const 4))
          (then
            (global.set $steps
              (i32.sub (global.get $steps)
                (i32.sub
                  (i32.mul (local.get $private_groups) (local.get $cost))
                  (i32.const 4))))))
        (if (i32.gt_u (local.get $private_groups) (i32.const 1))
          (then
            (global.set $block_budget
              (i32.sub (global.get $block_budget)
                (i32.sub (local.get $private_groups) (i32.const 1))))))
        (return_call $next)))
    (if (i32.eq (local.get $ctr_step) (i32.const -1))
      (then (call $set_flags_dec (local.get $old) (local.get $ctr)))
      (else (call $set_flags_inc (local.get $old) (local.get $ctr))))
    (global.set $eip
      (select (local.get $back) (local.get $fall) (i32.ne (local.get $ctr) (i32.const 0)))))

  ;; ------------------------------------------------------------------
  ;; 435: PACKED_AVG_RUN
  ;; ------------------------------------------------------------------
  ;; Collapse every iteration before the final one, then continue into an
  ;; ordinary copy of the complete final guest iteration. That suffix owns all
  ;; architectural scratch registers and flags; this handler only publishes
  ;; stream cursors and the induction register at a guest-iteration boundary.
  ;;
  ;; op selects the arithmetic:
  ;;   0 WIDE_ADD_SHIFT:     u32((u64(a&mask) + u64(b&mask)) >> 1)
  ;;   1 SHIFT_MASK_ADD:     ((a>>1)&mask) + ((b>>1)&mask)
  ;;   2 SHIFT_MASK_ADD_LSB: mode 1 + (a&b&round_mask)
  ;;
  ;; Descriptor words:
  ;;   0 mask  1 round_mask
  ;;   2..6   src A: base_reg,index_reg(-1 none),scale,disp,base_step
  ;;   7..11  src B: base_reg,index_reg(-1 none),scale,disp,base_step
  ;;   12..16 dst:   base_reg,index_reg(-1 none),scale,disp,base_step
  ;;   17 induction_reg  18 induction_step
  ;;   19 termination (0 count-down/JNZ leaves 1, 1 signed-index/JGE leaves 0)
  ;;   20 original handlers per iteration
  (global $LOOP_SUPEROP_AVG i32 (i32.const 435))

  (func $packed_avg_addr
    (param $base i32) (param $index_reg i32) (param $ind_reg i32)
    (param $ind i32) (param $scale i32) (param $disp i32) (result i32)
    (local $index i32)
    (if (i32.ge_s (local.get $index_reg) (i32.const 0))
      (then
        (local.set $index
          (select (local.get $ind) (call $get_reg (local.get $index_reg))
            (i32.eq (local.get $index_reg) (local.get $ind_reg))))))
    (i32.add (i32.add (local.get $base)
      (i32.shl (local.get $index) (local.get $scale))) (local.get $disp)))

  (func $th_packed_avg_run (param $mode i32)
    (local $mask i32) (local $round_mask i32)
    (local $a_base_reg i32) (local $a_index i32) (local $a_scale i32)
    (local $a_disp i32) (local $a_step i32) (local $a_base i32)
    (local $b_base_reg i32) (local $b_index i32) (local $b_scale i32)
    (local $b_disp i32) (local $b_step i32) (local $b_base i32)
    (local $d_base_reg i32) (local $d_index i32) (local $d_scale i32)
    (local $d_disp i32) (local $d_step i32) (local $d_base i32)
    (local $ind_reg i32) (local $ind_step i32) (local $term i32)
    (local $cost i32) (local $ind i32) (local $remaining i32)
    (local $allowed i32) (local $n i32) (local $done i32)
    (local $a i32) (local $b i32) (local $v i32) (local $sum i64)

    (local.set $mask (call $read_thread_word))
    (local.set $round_mask (call $read_thread_word))
    (local.set $a_base_reg (call $read_thread_word))
    (local.set $a_index (call $read_thread_word))
    (local.set $a_scale (call $read_thread_word))
    (local.set $a_disp (call $read_thread_word))
    (local.set $a_step (call $read_thread_word))
    (local.set $b_base_reg (call $read_thread_word))
    (local.set $b_index (call $read_thread_word))
    (local.set $b_scale (call $read_thread_word))
    (local.set $b_disp (call $read_thread_word))
    (local.set $b_step (call $read_thread_word))
    (local.set $d_base_reg (call $read_thread_word))
    (local.set $d_index (call $read_thread_word))
    (local.set $d_scale (call $read_thread_word))
    (local.set $d_disp (call $read_thread_word))
    (local.set $d_step (call $read_thread_word))
    (local.set $ind_reg (call $read_thread_word))
    (local.set $ind_step (call $read_thread_word))
    (local.set $term (call $read_thread_word))
    (local.set $cost (call $read_thread_word))

    (local.set $a_base (call $get_reg (local.get $a_base_reg)))
    (local.set $b_base (call $get_reg (local.get $b_base_reg)))
    (local.set $d_base (call $get_reg (local.get $d_base_reg)))
    (local.set $ind (call $get_reg (local.get $ind_reg)))
    ;; The suffix executes one original iteration. Fold only the iterations
    ;; before it, so a zero/negative do-while entry naturally stays ordinary.
    (if (local.get $term)
      (then
        (if (i32.gt_s (local.get $ind) (i32.const 0))
          (then (local.set $remaining (local.get $ind)))))
      (else
        (if (i32.gt_u (local.get $ind) (i32.const 1))
          (then (local.set $remaining (i32.sub (local.get $ind) (i32.const 1)))))))

    (local.set $allowed
      (i32.div_u
        (i32.add
          (select (global.get $steps) (i32.const 0)
            (i32.gt_s (global.get $steps) (i32.const 0)))
          (i32.sub (local.get $cost) (i32.const 1)))
        (local.get $cost)))
    (local.set $n
      (select (local.get $remaining) (local.get $allowed)
        (i32.lt_u (local.get $remaining) (local.get $allowed))))
    (local.set $done (local.get $n))

    (block $finished
      (loop $pixels
        (br_if $finished (i32.eqz (local.get $done)))
        ;; Preserve the guest's load-A, load-B, store order for overlap.
        (local.set $a (call $gl32 (call $packed_avg_addr
          (local.get $a_base) (local.get $a_index) (local.get $ind_reg)
          (local.get $ind) (local.get $a_scale) (local.get $a_disp))))
        (local.set $b (call $gl32 (call $packed_avg_addr
          (local.get $b_base) (local.get $b_index) (local.get $ind_reg)
          (local.get $ind) (local.get $b_scale) (local.get $b_disp))))
        (if (i32.eqz (local.get $mode))
          (then
            (local.set $sum
              (i64.add
                (i64.extend_i32_u (i32.and (local.get $a) (local.get $mask)))
                (i64.extend_i32_u (i32.and (local.get $b) (local.get $mask)))))
            (local.set $v
              (i32.wrap_i64 (i64.shr_u (local.get $sum) (i64.const 1)))))
          (else
            (local.set $v
              (i32.add
                (i32.and (i32.shr_u (local.get $a) (i32.const 1)) (local.get $mask))
                (i32.and (i32.shr_u (local.get $b) (i32.const 1)) (local.get $mask))))
            (if (i32.eq (local.get $mode) (i32.const 2))
              (then (local.set $v (i32.add (local.get $v)
                (i32.and (i32.and (local.get $a) (local.get $b))
                  (local.get $round_mask))))))))
        (call $gs32 (call $packed_avg_addr
          (local.get $d_base) (local.get $d_index) (local.get $ind_reg)
          (local.get $ind) (local.get $d_scale) (local.get $d_disp)) (local.get $v))

        (local.set $a_base (i32.add (local.get $a_base) (local.get $a_step)))
        (local.set $b_base (i32.add (local.get $b_base) (local.get $b_step)))
        (local.set $d_base (i32.add (local.get $d_base) (local.get $d_step)))
        (local.set $ind (i32.add (local.get $ind) (local.get $ind_step)))
        (local.set $done (i32.sub (local.get $done) (i32.const 1)))
        (br $pixels)))

    (if (local.get $n)
      (then
        (if (local.get $a_step)
          (then (call $set_reg (local.get $a_base_reg) (local.get $a_base))))
        (if (local.get $b_step)
          (then (call $set_reg (local.get $b_base_reg) (local.get $b_base))))
        (if (local.get $d_step)
          (then (call $set_reg (local.get $d_base_reg) (local.get $d_base))))
        (call $set_reg (local.get $ind_reg) (local.get $ind))))
    (global.set $loop_avg_runs
      (i32.add (global.get $loop_avg_runs) (i32.const 1)))
    (global.set $loop_avg_pixels
      (i64.add (global.get $loop_avg_pixels) (i64.extend_i32_u (local.get $n))))
    ;; H435 and the ordinary suffix are charged automatically. Replace H435's
    ;; extra charge with the cost of the N folded guest iterations.
    (global.set $steps
      (i32.sub (global.get $steps)
        (i32.sub (i32.mul (local.get $n) (local.get $cost)) (i32.const 1))))
    (global.set $block_budget
      (i32.sub (global.get $block_budget) (local.get $n)))
    (return_call $next))

  ;; ------------------------------------------------------------------
  ;; 436: MW3 bound-derived RGB565 alpha row
  ;; ------------------------------------------------------------------
  ;; Replay the exact three-arm loop at mech3demo!0x528064. The row bound,
  ;; alpha cursor and destination cursor remain in the guest's own frame slots;
  ;; publishing them after every pixel preserves the ordinary loop's visible
  ;; state even when the 4096-pixel safety quantum hands control back early.
  (func $th_rgb565_alpha_run (param $op i32)
    (local $tp i32) (local $fall i32) (local $back i32)
    (local $bp i32) (local $eax i32) (local $ecx i32) (local $edx i32)
    (local $ebx i32) (local $esi i32) (local $edi i32)
    (local $alpha i32) (local $count i32) (local $old_count i32)
    (local $iters i32) (local $cost i32) (local $cont i32)

    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 8)))
    (local.set $fall (i32.load (local.get $tp)))
    (local.set $back (i32.load offset=4 (local.get $tp)))
    (local.set $bp (global.get $ebp))
    (local.set $eax (global.get $eax))
    (local.set $ecx (global.get $ecx))
    (local.set $edx (global.get $edx))
    (local.set $ebx (global.get $ebx))
    (local.set $esi (global.get $esi))
    (local.set $edi (global.get $edi))
    (local.set $count (call $gl32 (i32.add (local.get $bp) (i32.const -24))))

    (block $done (loop $pixels
      ;; A normal entry is dominated by TEST count / JLE exit. Keep a corrupt
      ;; or direct zero entry bounded instead of manufacturing 2^32 pixels.
      (br_if $done (i32.le_s (local.get $count) (i32.const 0)))
      (br_if $done (i32.ge_u (local.get $iters) (i32.const 4096)))

      ;; mov ecx,[ebp+0xc] / mov cl,[ecx]
      (local.set $ecx (call $gl32 (i32.add (local.get $bp) (i32.const 12))))
      (local.set $alpha (call $gl8 (local.get $ecx)))
      (local.set $ecx
        (i32.or (i32.and (local.get $ecx) (i32.const 0xFFFFFF00))
                (local.get $alpha)))
      (local.set $cost (i32.add (local.get $cost) (i32.const 13)))

      (if (i32.gt_u (local.get $alpha) (i32.const 3))
        (then
          (local.set $cost (i32.add (local.get $cost) (i32.const 5)))
          (if (i32.ge_u (local.get $alpha) (i32.const 0xFC))
            (then
              ;; Opaque arm: copy the source RGB565 word verbatim.
              (local.set $ecx
                (i32.or (i32.and (local.get $ecx) (i32.const 0xFFFF0000))
                  (call $gl16 (i32.add (local.get $eax) (local.get $edi)))))
              (call $gs16 (local.get $eax) (local.get $ecx)))
            (else
              ;; Interpolate each RGB565 lane with the exact signed shifts and
              ;; low-byte fixups emitted by MSVC 5. No host colour conversion.
              (local.set $cost (i32.add (local.get $cost) (i32.const 35)))
              (local.set $esi (i32.extend16_s (call $gl16 (local.get $eax))))
              (local.set $edx
                (i32.extend16_s (call $gl16
                  (i32.add (local.get $eax) (local.get $edi)))))
              (local.set $edi (local.get $ecx))
              (local.set $ecx (local.get $edx))
              (local.set $eax (local.get $esi))
              (local.set $ecx (i32.and (local.get $ecx) (i32.const 0xF800)))
              (local.set $eax (i32.and (local.get $eax) (i32.const 0xF800)))
              (local.set $ebx (local.get $esi))
              (local.set $ecx (i32.sub (local.get $ecx) (local.get $eax)))
              (local.set $eax (local.get $edx))
              (local.set $eax (i32.and (local.get $eax) (i32.const 0x07E0)))
              (local.set $ebx (i32.and (local.get $ebx) (i32.const 0x07E0)))
              (local.set $edi (i32.and (local.get $edi) (i32.const 0xFF)))
              (local.set $eax (i32.sub (local.get $eax) (local.get $ebx)))
              (local.set $eax (i32.mul (local.get $eax) (local.get $edi)))
              (local.set $ecx (i32.mul (local.get $ecx) (local.get $edi)))
              (local.set $eax (i32.shr_s (local.get $eax) (i32.const 8)))
              (local.set $ecx (i32.shr_s (local.get $ecx) (i32.const 8)))
              (local.set $eax (i32.and (local.get $eax) (i32.const 0xFFFFFFE0)))
              (local.set $ecx (i32.and (local.get $ecx) (i32.const 0xFFFFF800)))
              (if (i32.lt_s (local.get $eax) (i32.const 0))
                (then (local.set $eax (i32.or (local.get $eax) (i32.const 0x20))))
                (else (local.set $eax
                  (i32.and (local.get $eax) (i32.const 0xFFFFFFDF)))))
              (local.set $esi (i32.add (local.get $esi) (local.get $ecx)))
              (local.set $edx (i32.and (local.get $edx) (i32.const 0x1F)))
              (local.set $ecx (i32.and (local.get $esi) (i32.const 0x1F)))
              (local.set $ebx (call $gl32
                (i32.add (local.get $bp) (i32.const -12))))
              (local.set $edx (i32.sub (local.get $edx) (local.get $ecx)))
              (local.set $edx (i32.mul (local.get $edx) (local.get $edi)))
              (local.set $edi (call $gl32
                (i32.add (local.get $bp) (i32.const -28))))
              (local.set $edx (i32.shr_s (local.get $edx) (i32.const 8)))
              (local.set $edx (i32.add (local.get $edx) (local.get $eax)))
              (local.set $eax (call $gl32
                (i32.add (local.get $bp) (i32.const -32))))
              (local.set $esi (i32.add (local.get $esi) (local.get $edx)))
              (local.set $edx (call $gl32
                (i32.add (local.get $bp) (i32.const -20))))
              (call $gs16 (local.get $eax) (local.get $esi))))))

      ;; Common induction tail. These stores are deliberately per pixel: the
      ;; guest frame is the loop's architectural bound/cursor state.
      (local.set $esi (call $gl32 (i32.add (local.get $bp) (i32.const 12))))
      (local.set $count (call $gl32 (i32.add (local.get $bp) (i32.const -24))))
      (local.set $eax (i32.add (local.get $eax) (i32.const 2)))
      (local.set $esi (i32.add (local.get $esi) (i32.const 1)))
      (local.set $old_count (local.get $count))
      (local.set $count (i32.sub (local.get $count) (i32.const 1)))
      (call $gs32 (i32.add (local.get $bp) (i32.const -32)) (local.get $eax))
      (call $gs32 (i32.add (local.get $bp) (i32.const 12)) (local.get $esi))
      (call $gs32 (i32.add (local.get $bp) (i32.const -24)) (local.get $count))
      (local.set $iters (i32.add (local.get $iters) (i32.const 1)))
      (br_if $pixels (local.get $count))))

    (global.set $eax (local.get $eax))
    (global.set $ecx (local.get $count))
    (global.set $edx (local.get $edx))
    (global.set $ebx (local.get $ebx))
    (global.set $esi (local.get $esi))
    (global.set $edi (local.get $edi))
    (if (local.get $iters)
      (then (call $set_flags_dec (local.get $old_count) (local.get $count))))
    (global.set $steps
      (i32.sub (global.get $steps)
        (i32.sub (local.get $cost) (i32.const 1))))
    (global.set $block_budget
      (i32.sub (global.get $block_budget) (local.get $iters)))
    (global.set $loop_rgb565_alpha_runs
      (i32.add (global.get $loop_rgb565_alpha_runs) (i32.const 1)))
    (global.set $loop_rgb565_alpha_pixels
      (i64.add (global.get $loop_rgb565_alpha_pixels)
        (i64.extend_i32_u (local.get $iters))))
    (local.set $cont (i32.ne (local.get $count) (i32.const 0)))
    (global.set $eip
      (select (local.get $back) (local.get $fall) (local.get $cont)))
    (return_call $branch_end))

  ;; ------------------------------------------------------------------
  ;; 440: MW3 counted RGB565 color-key row
  ;; ------------------------------------------------------------------
  ;; Replay mech3demo!0x528268 one pixel at a time. In particular, do not
  ;; replace this with memory.copy or a SIMD load batch: [EAX+EBX] may overlap
  ;; a later [EAX], and the x86 loop observes each preceding conditional store.
  (func $th_rgb565_colorkey_run (param $op i32)
    (local $tp i32) (local $fall i32) (local $back i32)
    (local $eax i32) (local $ecx i32) (local $esi i32)
    (local $old_eax i32) (local $old_esi i32)
    (local $key i32) (local $pixel i32)
    (local $total i32) (local $allowed i32) (local $n i32)
    (local $iters i32) (local $cost i32)

    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 8)))
    (local.set $fall (i32.load (local.get $tp)))
    (local.set $back (i32.load offset=4 (local.get $tp)))
    (local.set $eax (global.get $eax))
    (local.set $ecx (global.get $ecx))
    (local.set $esi (global.get $esi))
    (local.set $key
      (call $gl16 (i32.add (global.get $ebp) (i32.const 12))))

    ;; The authentic predecessor proves ESI > 0. Retain do-while behavior for
    ;; a synthetic zero entry by executing one iteration and resuming at the
    ;; back edge with ESI=0xffffffff.
    (local.set $total
      (select (local.get $esi) (i32.const 1)
        (i32.ne (local.get $esi) (i32.const 0))))

    ;; Six handlers for a transparent pixel, seven for a copied pixel. Budget
    ;; for the larger arm; exact handler accounting is accumulated below.
    (local.set $allowed
      (i32.div_u
        (i32.add
          (select (global.get $steps) (i32.const 0)
            (i32.gt_s (global.get $steps) (i32.const 0)))
          (i32.const 6))
        (i32.const 7)))
    (if (i32.eqz (local.get $allowed))
      (then (local.set $allowed (i32.const 1))))
    (local.set $n
      (select (local.get $total) (local.get $allowed)
        (i32.lt_u (local.get $total) (local.get $allowed))))

    ;; Each original pixel crosses the compare/JZ block and the induction
    ;; block. The current H440 block was already charged by $run.
    (local.set $allowed
      (i32.div_u
        (i32.add
          (select (global.get $block_budget) (i32.const 0)
            (i32.gt_s (global.get $block_budget) (i32.const 0)))
          (i32.const 1))
        (i32.const 2)))
    (if (i32.eqz (local.get $allowed))
      (then (local.set $allowed (i32.const 1))))
    (if (i32.gt_u (local.get $n) (local.get $allowed))
      (then (local.set $n (local.get $allowed))))

    (block $done (loop $pixels
      (br_if $done (i32.ge_u (local.get $iters) (local.get $n)))
      (local.set $old_eax (local.get $eax))
      (local.set $pixel (call $gl16 (local.get $eax)))
      (local.set $ecx
        (i32.or (i32.and (local.get $ecx) (i32.const 0xffff0000))
                (local.get $pixel)))
      (if (i32.ne (local.get $pixel) (local.get $key))
        (then
          (call $gs16
            (i32.add (local.get $eax) (global.get $ebx))
            (local.get $pixel))
          (local.set $cost (i32.add (local.get $cost) (i32.const 7))))
        (else
          (local.set $cost (i32.add (local.get $cost) (i32.const 6)))))
      (local.set $eax (i32.add (local.get $eax) (i32.const 2)))
      (local.set $old_esi (local.get $esi))
      (local.set $esi (i32.sub (local.get $esi) (i32.const 1)))
      (local.set $iters (i32.add (local.get $iters) (i32.const 1)))
      (br $pixels)))

    (global.set $eax (local.get $eax))
    (global.set $ecx (local.get $ecx))
    (global.set $esi (local.get $esi))
    ;; ADD EAX,2 sets CF; DEC ESI then replaces every arithmetic flag except
    ;; that CF. Publish them in precisely that order for the final iteration.
    (call $set_flags_add
      (local.get $old_eax) (i32.const 2) (local.get $eax))
    (call $set_flags_dec (local.get $old_esi) (local.get $esi))

    (global.set $steps
      (i32.sub (global.get $steps)
        (i32.sub (local.get $cost) (i32.const 1))))
    (global.set $block_budget
      (i32.sub (global.get $block_budget)
        (i32.sub (i32.mul (local.get $iters) (i32.const 2)) (i32.const 1))))
    (global.set $loop_rgb565_colorkey_runs
      (i32.add (global.get $loop_rgb565_colorkey_runs) (i32.const 1)))
    (global.set $loop_rgb565_colorkey_pixels
      (i64.add (global.get $loop_rgb565_colorkey_pixels)
        (i64.extend_i32_u (local.get $iters))))
    (global.set $eip
      (select (local.get $back) (local.get $fall)
        (i32.ne (local.get $esi) (i32.const 0))))
    (return_call $branch_end))

  ;; ------------------------------------------------------------------
  ;; 441: MW3 in-place 16-bit terrain/grid filter row
  ;; ------------------------------------------------------------------
  ;; The authentic inner loop at mech3demo!0x518f02 is a scalar, in-place
  ;; nine-neighbour filter. One trip costs 37 threaded x86 handlers and 14
  ;; guest-memory operations. Keep its original access order: a preceding
  ;; destination store can feed a later neighbour load in the same row, so a
  ;; SIMD batch would change the result. The affine probes only collapse
  ;; address translation for each adjacent 3-word neighbourhood; every load
  ;; and store remains ordered exactly as the x86 stream.
  (func $th_mw3_grid_filter_run (param $op i32)
    (local $tp i32) (local $fall i32) (local $back i32)
    (local $eax i32) (local $ecx i32) (local $edx i32) (local $ebx i32)
    (local $esp i32) (local $ebp i32) (local $esi i32) (local $edi i32)
    (local $stride i32) (local $width i32) (local $count i32)
    (local $old_count i32) (local $v i32)
    (local $eax_wa i32) (local $upper_wa i32) (local $lower_wa i32)
    (local $stack_wa i32) (local $allowed i32) (local $block_allowed i32)
    (local $iters i32) (local $add_lhs i32) (local $add_rhs i32)
    (local $add_result i32)

    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 8)))
    (local.set $fall (i32.load (local.get $tp)))
    (local.set $back (i32.load offset=4 (local.get $tp)))
    (local.set $eax (global.get $eax))
    (local.set $ecx (global.get $ecx))
    (local.set $edx (global.get $edx))
    (local.set $ebx (global.get $ebx))
    (local.set $esp (global.get $esp))
    (local.set $ebp (global.get $ebp))
    (local.set $esi (global.get $esi))
    (local.set $edi (global.get $edi))

    ;; [ESP+10h], [ESP+14h], and [ESP+20h] are reloaded in the body in the
    ;; authentic order. Translate their enclosing span once without caching
    ;; values, so even a synthetic alias with the grid observes intervening
    ;; stores exactly as x86 does.
    (local.set $stack_wa
      (call $g2w_affine_span
        (i32.add (local.get $esp) (i32.const 0x10)) (i32.const 0x14)))
    (if (i32.eq (local.get $stack_wa) (global.get $NULL_SENTINEL))
      (then (local.set $stack_wa (i32.const 0))))

    ;; $next already charged the H441 dispatch. Permit only as many complete
    ;; 37-handler/one-basic-block trips as the ordinary stream could retire.
    (local.set $allowed
      (i32.div_u
        (i32.add
          (select (global.get $steps) (i32.const 0)
            (i32.gt_s (global.get $steps) (i32.const 0)))
          (i32.const 36))
        (i32.const 37)))
    (if (i32.eqz (local.get $allowed))
      (then (local.set $allowed (i32.const 1))))
    (local.set $block_allowed
      (i32.add
        (select (global.get $block_budget) (i32.const 0)
          (i32.gt_s (global.get $block_budget) (i32.const 0)))
        (i32.const 1)))
    (if (i32.gt_u (local.get $allowed) (local.get $block_allowed))
      (then (local.set $allowed (local.get $block_allowed))))

    (block $done (loop $cells
      (br_if $done (i32.ge_u (local.get $iters) (local.get $allowed)))

      ;; mov edx,[esp+20h]
      (local.set $stride
        (if (result i32) (local.get $stack_wa)
          (then (i32.load offset=16 (local.get $stack_wa)))
          (else (call $gl32 (i32.add (local.get $esp) (i32.const 0x20))))))
      (local.set $edx (local.get $stride))

      ;; Advance the two row cursors, then derive the upper-row and parity
      ;; addresses with the same wrapping i32 arithmetic as x86.
      (local.set $eax (i32.add (local.get $eax) (i32.const 2)))
      (local.set $edi (local.get $eax))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $ecx)))
      (local.set $edi (i32.sub (local.get $edi) (local.get $ecx)))
      (local.set $ecx (local.get $eax))
      (local.set $ecx (i32.sub (local.get $ecx) (local.get $edx)))
      (local.set $esi (i32.add (local.get $esi) (i32.const 2)))

      ;; Prove the three adjacent word neighbourhoods once apiece. The fallback
      ;; helpers retain sparse/unmapped behavior at a mapping boundary.
      (local.set $eax_wa
        (call $g2w_affine_span
          (i32.sub (local.get $eax) (i32.const 2)) (i32.const 6)))
      (if (i32.eq (local.get $eax_wa) (global.get $NULL_SENTINEL))
        (then (local.set $eax_wa (i32.const 0))))
      (local.set $upper_wa
        (call $g2w_affine_span (local.get $edi) (i32.const 3)))
      (if (i32.eq (local.get $upper_wa) (global.get $NULL_SENTINEL))
        (then (local.set $upper_wa (i32.const 0))))
      (local.set $lower_wa
        (call $g2w_affine_span
          (i32.sub (local.get $esi) (i32.const 2)) (i32.const 6)))
      (if (i32.eq (local.get $lower_wa) (global.get $NULL_SENTINEL))
        (then (local.set $lower_wa (i32.const 0))))

      ;; Right neighbour, parity byte, and current word.
      (local.set $edx
        (i32.extend16_s
          (if (result i32) (local.get $eax_wa)
            (then (i32.load16_u offset=4 (local.get $eax_wa)))
            (else (call $gl16 (i32.add (local.get $eax) (i32.const 2)))))))
      (local.set $ecx
        (i32.or (i32.and (local.get $ecx) (i32.const 0xffffff00))
          (call $gl8 (local.get $ecx))))
      (local.set $ebp
        (i32.or (i32.and (local.get $ebp) (i32.const 0xffff0000))
          (if (result i32) (local.get $eax_wa)
            (then (i32.load16_u offset=2 (local.get $eax_wa)))
            (else (call $gl16 (local.get $eax))))))
      (local.set $ecx (i32.and (local.get $ecx) (i32.const 1)))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))

      ;; Same-row left parity.
      (local.set $edx
        (i32.or (i32.and (local.get $edx) (i32.const 0xffffff00))
          (if (result i32) (local.get $eax_wa)
            (then (i32.load8_u (local.get $eax_wa)))
            (else (call $gl8 (i32.sub (local.get $eax) (i32.const 2)))))))
      (local.set $edx (i32.and (local.get $edx) (i32.const 1)))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))

      ;; Upper-row parity bytes.
      (local.set $edx
        (i32.or (i32.and (local.get $edx) (i32.const 0xffffff00))
          (if (result i32) (local.get $upper_wa)
            (then (i32.load8_u (local.get $upper_wa)))
            (else (call $gl8 (local.get $edi))))))
      (local.set $edx (i32.and (local.get $edx) (i32.const 1)))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))
      (local.set $edx
        (i32.or (i32.and (local.get $edx) (i32.const 0xffffff00))
          (if (result i32) (local.get $upper_wa)
            (then (i32.load8_u offset=2 (local.get $upper_wa)))
            (else (call $gl8 (i32.add (local.get $edi) (i32.const 2)))))))
      (local.set $edx (i32.and (local.get $edx) (i32.const 1)))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))

      ;; Lower-row left, right, and centre signed words.
      (local.set $edx
        (i32.extend16_s
          (if (result i32) (local.get $lower_wa)
            (then (i32.load16_u (local.get $lower_wa)))
            (else (call $gl16 (i32.sub (local.get $esi) (i32.const 2)))))))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))
      (local.set $edx
        (i32.extend16_s
          (if (result i32) (local.get $lower_wa)
            (then (i32.load16_u offset=4 (local.get $lower_wa)))
            (else (call $gl16 (i32.add (local.get $esi) (i32.const 2)))))))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))
      (local.set $edx
        (i32.extend16_s
          (if (result i32) (local.get $lower_wa)
            (then (i32.load16_u offset=2 (local.get $lower_wa)))
            (else (call $gl16 (local.get $esi))))))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))

      ;; Current word is sign-extended from BP. Preserve the last ADD's CF;
      ;; the following LEA/MOVs do not touch flags and DEC replaces every
      ;; arithmetic flag except CF.
      (local.set $edx (i32.extend16_s (local.get $ebp)))
      (local.set $add_lhs (local.get $ecx))
      (local.set $add_rhs (local.get $edx))
      (local.set $ecx (i32.add (local.get $ecx) (local.get $edx)))
      (local.set $add_result (local.get $ecx))
      (local.set $ecx
        (i32.add (local.get $ebp) (i32.shl (local.get $ecx) (i32.const 1))))
      (if (local.get $eax_wa)
        (then
          ;; The affine translation removes repeated $g2w calls, not the
          ;; scalar store's SMC contract. Retire decoded bytes before writing
          ;; through the cached WAT address just as $gs16 would.
          (call $invalidate_code_write (local.get $eax) (i32.const 2))
          (i32.store16 offset=2 (local.get $eax_wa) (local.get $ecx)))
        (else (call $gs16 (local.get $eax) (local.get $ecx))))

      ;; Counter load/DEC/store, then width reload. Branch on the DEC result,
      ;; not on ECX after the width MOV.
      (local.set $count
        (if (result i32) (local.get $stack_wa)
          (then (i32.load (local.get $stack_wa)))
          (else (call $gl32 (i32.add (local.get $esp) (i32.const 0x10))))))
      (local.set $old_count (local.get $count))
      (local.set $count (i32.sub (local.get $count) (i32.const 1)))
      (if (local.get $stack_wa)
        (then
          (call $invalidate_code_write
            (i32.add (local.get $esp) (i32.const 0x10)) (i32.const 4))
          (i32.store (local.get $stack_wa) (local.get $count)))
        (else (call $gs32
          (i32.add (local.get $esp) (i32.const 0x10)) (local.get $count))))
      (local.set $width
        (if (result i32) (local.get $stack_wa)
          (then (i32.load offset=4 (local.get $stack_wa)))
          (else (call $gl32 (i32.add (local.get $esp) (i32.const 0x14))))))
      (local.set $ecx (local.get $width))
      (local.set $iters (i32.add (local.get $iters) (i32.const 1)))
      (br_if $cells
        (i32.and (i32.ne (local.get $count) (i32.const 0))
          (i32.lt_u (local.get $iters) (local.get $allowed))))))

    (global.set $eax (local.get $eax))
    (global.set $ecx (local.get $ecx))
    (global.set $edx (local.get $edx))
    (global.set $ebx (local.get $ebx))
    (global.set $ebp (local.get $ebp))
    (global.set $esi (local.get $esi))
    (global.set $edi (local.get $edi))
    (call $set_flags_add
      (local.get $add_lhs) (local.get $add_rhs) (local.get $add_result))
    (call $set_flags_dec (local.get $old_count) (local.get $count))
    (global.set $steps
      (i32.sub (global.get $steps)
        (i32.sub (i32.mul (local.get $iters) (i32.const 37)) (i32.const 1))))
    (global.set $block_budget
      (i32.sub (global.get $block_budget)
        (i32.sub (local.get $iters) (i32.const 1))))
    (global.set $loop_mw3_grid_filter_runs
      (i32.add (global.get $loop_mw3_grid_filter_runs) (i32.const 1)))
    (global.set $loop_mw3_grid_filter_cells
      (i64.add (global.get $loop_mw3_grid_filter_cells)
        (i64.extend_i32_u (local.get $iters))))
    (global.set $eip
      (select (local.get $back) (local.get $fall)
        (i32.ne (local.get $count) (i32.const 0))))
    (return_call $branch_end))

  ;; Called from $decode_block just before $cache_store.
  (func $loop_match_block (param $start_eip i32) (param $tstart i32)
    (if (global.get $op_index_poison) (then (return)))
    (if (i32.eqz (call $loop_is_selfloop (local.get $start_eip))) (then (return)))
    (global.set $loop_selfloop_blocks
      (i32.add (global.get $loop_selfloop_blocks) (i32.const 1)))
    (if (global.get $loop_trace)
      (then
        (if (i32.or (i32.eqz (global.get $loop_trace_eip))
                    (i32.eq (global.get $loop_trace_eip) (local.get $start_eip)))
          (then (call $loop_trace_block (local.get $start_eip))))))
    ;; Ordered cheapest-to-decline first; the predicates are disjoint (LUT_RUN
    ;; requires an indexed load and a zeroing op, COPY_RUN forbids both), so
    ;; the order is a cost choice, not a precedence one.
    (if (call $loop_try_aoe_grid_fill (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_lut16_counted (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_lut (local.get $start_eip) (local.get $tstart)) (then (return)))
    (if (call $loop_try_lut_bounded (local.get $start_eip) (local.get $tstart)) (then (return)))
    (if (call $loop_try_lut_blend_bounded (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_avg_wide_indexed (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_avg_shift_cursor (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_avg_round_cursor (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_copy32_bounded (local.get $start_eip) (local.get $tstart))
      (then (return)))
    (if (call $loop_try_copy (local.get $start_eip) (local.get $tstart))
      (then (return)))
    ;; TREE_FOLD is deliberately LAST. Every family above proves one exact
    ;; idiom and executes it with semantics written for that idiom; this one
    ;; is a general interpreter over whatever dataflow the block contains, so
    ;; it is strictly the weaker lowering wherever an exact family also
    ;; matches. Trying it last means it can only ever claim blocks nothing
    ;; else wanted, and adding it can never change what an existing fold does.
    (drop (call $loop_try_tree_fold (local.get $start_eip) (local.get $tstart))))

  ;; ------------------------------------------------------------------
  ;; 437: AoE byte-grid FILL_RUN
  ;; ------------------------------------------------------------------
  ;; AoE I/II clear rectangular pathfinding grids with this exact six-op
  ;; self-loop (AoE II 0x005def8e):
  ;;
  ;;   mov edi,[esi+0x408] / inc eax / cmp eax,edx
  ;;   mov edi,[edi+ecx*4] / mov byte [edi+eax-1],0xff / jl ^
  ;;
  ;; Prove the complete emitted form, including both SIB descriptors, rather
  ;; than keying the core on one game's EIP. A near miss remains ordinary x86.
  (func $loop_try_aoe_grid_fill
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $p i32) (local $fall i32) (local $back i32)

    (if (i32.ne (global.get $op_index_n) (i32.const 6))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 0)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 345))
          (i32.or
            (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (i32.const 7))
            (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 0x408))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 1)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 64))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0)))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 2)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 19))
          (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (i32.const 2)))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 3)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 389))
          (i32.or
            (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (i32.const 7))
            (i32.or
              (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 0x217))
              (i32.ne (i32.load offset=12 (local.get $p)) (i32.const 0)))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 4)))
    (if (i32.or
          (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 402))
          (i32.or
            (i32.ne (load.field.memarg LoopOp operand (local.get $p)) (i32.const 0xff))
            (i32.or
              (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 7))
              (i32.ne (i32.load offset=12 (local.get $p)) (i32.const -1)))))
      (then (return (i32.const 0))))

    (local.set $p (call $loop_op_at (i32.const 5)))
    (if (i32.ne (load.field LoopOp handler (local.get $p)) (i32.const 319))
      (then (return (i32.const 0))))
    (local.set $fall (i32.load offset=8 (local.get $p)))
    (local.set $back (i32.load offset=12 (local.get $p)))
    (if (i32.ne (local.get $back) (local.get $start_eip))
      (then (return (i32.const 0))))

    (global.set $loop_aoe_fill_matches
      (i32.add (global.get $loop_aoe_fill_matches) (i32.const 1)))
    (if (i32.eqz (global.get $loop_aoe_fill_emit_enabled))
      (then (return (i32.const 0))))

    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (i32.const 437) (i32.const 0))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $back))
    (i32.const 1))

  (func $th_aoe_grid_fill (param $op i32)
    (local $tp i32) (local $fall i32) (local $back i32)
    (local $old i32) (local $end i32) (local $next_index i32)
    (local $total i32) (local $n i32) (local $allowed i32)
    (local $table i32) (local $entry i32) (local $row i32)
    (local $dst i32) (local $wa i32) (local $fast i32)

    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 8)))
    (local.set $fall (i32.load (local.get $tp)))
    (local.set $back (i32.load offset=4 (local.get $tp)))
    (local.set $old (global.get $eax))
    (local.set $end (global.get $edx))

    ;; The original is do-while. The bulk proof only covers the normal
    ;; monotonic interval; wrapped or reversed inputs execute the same six
    ;; operations below one iteration at a time.
    (local.set $total (i32.const 1))
    (if (i32.lt_s (local.get $old) (local.get $end))
      (then (local.set $total (i32.sub (local.get $end) (local.get $old)))))

    ;; Stop at the same guest-instruction and block budgets as the six-handler
    ;; loop. $next already charged H437 itself, hence cost-1 in this allowance.
    (local.set $allowed
      (i32.div_u
        (i32.add
          (select (global.get $steps) (i32.const 0)
            (i32.gt_s (global.get $steps) (i32.const 0)))
          (i32.const 5))
        (i32.const 6)))
    (if (i32.eqz (local.get $allowed))
      (then (local.set $allowed (i32.const 1))))
    (local.set $n
      (select (local.get $total) (local.get $allowed)
        (i32.lt_u (local.get $total) (local.get $allowed))))
    (local.set $allowed
      (select (i32.add (global.get $block_budget) (i32.const 1)) (i32.const 1)
        (i32.gt_s (global.get $block_budget) (i32.const 0))))
    (if (i32.gt_u (local.get $n) (local.get $allowed))
      (then (local.set $n (local.get $allowed))))

    (local.set $table (call $gl32 (i32.add (global.get $esi) (i32.const 0x408))))
    (local.set $entry
      (i32.add (local.get $table) (i32.shl (global.get $ecx) (i32.const 2))))
    (local.set $row (call $gl32 (local.get $entry)))
    (local.set $dst (i32.add (local.get $row) (local.get $old)))
    (local.set $wa (call $g2w_affine_span (local.get $dst) (local.get $n)))

    ;; Reloading the two pointers every original iteration is observable only
    ;; if the fill overwrites either pointer. Decline the bulk arm in that rare
    ;; alias case; the internal loop below retains the reload order exactly.
    (local.set $fast
      (i32.and
        (i32.lt_s (local.get $old) (local.get $end))
        (i32.and
          (i32.ne (local.get $wa) (global.get $NULL_SENTINEL))
          (i32.and
            (i32.or
              (i32.le_u (i32.add (local.get $dst) (local.get $n))
                        (i32.add (global.get $esi) (i32.const 0x408)))
              (i32.ge_u (local.get $dst)
                        (i32.add (global.get $esi) (i32.const 0x40c))))
            (i32.or
              (i32.le_u (i32.add (local.get $dst) (local.get $n)) (local.get $entry))
              (i32.ge_u (local.get $dst) (i32.add (local.get $entry) (i32.const 4))))))))

    (if (local.get $fast)
      (then
        (call $invalidate_code_write (local.get $dst) (local.get $n))
        (memory.fill (local.get $wa) (i32.const 0xff) (local.get $n))
        (local.set $next_index (i32.add (local.get $old) (local.get $n)))
        (global.set $eax (local.get $next_index))
        (global.set $edi (local.get $row))
        (call $set_flags_sub
          (local.get $next_index) (local.get $end)
          (i32.sub (local.get $next_index) (local.get $end))))
      (else
        (local.set $allowed (local.get $n))
        (loop $slow
          (local.set $table
            (call $gl32 (i32.add (global.get $esi) (i32.const 0x408))))
          (local.set $next_index (i32.add (global.get $eax) (i32.const 1)))
          (call $set_flags_sub
            (local.get $next_index) (local.get $end)
            (i32.sub (local.get $next_index) (local.get $end)))
          (local.set $row
            (call $gl32
              (i32.add (local.get $table) (i32.shl (global.get $ecx) (i32.const 2)))))
          (global.set $edi (local.get $row))
          (call $gs8 (i32.add (local.get $row) (global.get $eax)) (i32.const 0xff))
          (global.set $eax (local.get $next_index))
          (local.set $allowed (i32.sub (local.get $allowed) (i32.const 1)))
          (br_if $slow (local.get $allowed)))))

    (global.set $steps
      (i32.sub (global.get $steps)
        (i32.sub (i32.mul (local.get $n) (i32.const 6)) (i32.const 1))))
    (if (i32.gt_u (local.get $n) (i32.const 1))
      (then
        (global.set $block_budget
          (i32.sub (global.get $block_budget)
            (i32.sub (local.get $n) (i32.const 1))))))
    (global.set $loop_aoe_fill_runs
      (i32.add (global.get $loop_aoe_fill_runs) (i32.const 1)))
    (global.set $loop_aoe_fill_bytes
      (i64.add (global.get $loop_aoe_fill_bytes) (i64.extend_i32_u (local.get $n))))
    (global.set $eip
      (select (local.get $back) (local.get $fall)
        (i32.lt_s (global.get $eax) (local.get $end))))
    (return_call $branch_end))

  ;; 438: one span-prefix executor for both AoE builds. `op` selects only the
  ;; compiler register allocation: 1 = AoE I, 2 = AoE II. The clipping and
  ;; row-table algorithm, structure offsets, stack layout, and safety boundary
  ;; are shared.
  (func $th_aoe_span_prefix (param $op i32)
    (local $tp i32) (local $start i32) (local $reject_off i32)
    (local $old_esp i32) (local $esp_wa i32)
    (local $this i32) (local $this_wa i32)
    (local $row i32) (local $x0 i32) (local $x1 i32) (local $swap i32)
    (local $min_row i32) (local $max_row i32)
    (local $min_x i32) (local $max_x i32)
    (local $row_base i32) (local $row_head i32) (local $cost i32)

    (global.set $loop_aoe_span_runs
      (i32.add (global.get $loop_aoe_span_runs) (i32.const 1)))
    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 4)))
    (local.set $start (i32.load (local.get $tp)))
    (local.set $reject_off
      (select (i32.const 0x38d) (i32.const 0x3b4)
        (i32.eq (local.get $op) (i32.const 1))))

    ;; push ebx/ebp/esi; mov esi,ecx; push edi; mov edi,[esp+1c]
    (local.set $cost (i32.const 6))
    (local.set $old_esp (global.get $esp))
    (local.set $esp_wa (call $g2w (i32.sub (local.get $old_esp) (i32.const 16))))
    (i32.store offset=12 (local.get $esp_wa) (global.get $ebx))
    (i32.store offset=8 (local.get $esp_wa) (global.get $ebp))
    (i32.store offset=4 (local.get $esp_wa) (global.get $esi))
    (i32.store (local.get $esp_wa) (global.get $edi))
    (global.set $esp (i32.sub (local.get $old_esp) (i32.const 16)))
    (local.set $this (global.get $ecx))
    (local.set $this_wa (call $g2w (local.get $this)))
    (global.set $esi (local.get $this))
    (local.set $row (i32.load offset=28 (local.get $esp_wa)))
    (global.set $edi (local.get $row))

    (local.set $cost (i32.add (local.get $cost) (i32.const 2)))
    (local.set $min_row (i32.load offset=0x60 (local.get $this_wa)))
    (if (i32.lt_s (local.get $row) (local.get $min_row))
      (then
        (call $set_flags_sub
          (local.get $row) (local.get $min_row)
          (i32.sub (local.get $row) (local.get $min_row)))
        (global.set $steps
          (i32.sub (global.get $steps) (i32.sub (local.get $cost) (i32.const 1))))
        (global.set $eip (i32.add (local.get $start) (local.get $reject_off)))
        (return)))

    (local.set $cost (i32.add (local.get $cost) (i32.const 2)))
    (local.set $max_row (i32.load offset=0x64 (local.get $this_wa)))
    (if (i32.gt_s (local.get $row) (local.get $max_row))
      (then
        (call $set_flags_sub
          (local.get $row) (local.get $max_row)
          (i32.sub (local.get $row) (local.get $max_row)))
        (global.set $steps
          (i32.sub (global.get $steps) (i32.sub (local.get $cost) (i32.const 1))))
        (global.set $eip (i32.add (local.get $start) (local.get $reject_off)))
        (return)))

    (local.set $cost (i32.add (local.get $cost) (i32.const 4)))
    (local.set $x0 (i32.load offset=20 (local.get $esp_wa)))
    (local.set $x1 (i32.load offset=24 (local.get $esp_wa)))
    (if (i32.gt_s (local.get $x0) (local.get $x1))
      (then
        (local.set $cost (i32.add (local.get $cost) (i32.const 4)))
        (i32.store offset=24 (local.get $esp_wa) (local.get $x0))
        (i32.store offset=20 (local.get $esp_wa) (local.get $x1))
        (local.set $swap (local.get $x0))
        (local.set $x0 (local.get $x1))
        (local.set $x1 (local.get $swap))))

    (if (i32.eq (local.get $op) (i32.const 1))
      (then
        (global.set $eax (local.get $x0))
        (global.set $ebp (local.get $x1)))
      (else
        (global.set $ebx (local.get $x0))
        (global.set $ebp (local.get $x1))))

    (local.set $cost (i32.add (local.get $cost) (i32.const 3)))
    (local.set $min_x (i32.load offset=0x58 (local.get $this_wa)))
    (if (i32.eq (local.get $op) (i32.const 1))
      (then (global.set $ecx (local.get $min_x)))
      (else (global.set $eax (local.get $min_x))))
    (if (i32.lt_s (local.get $x1) (local.get $min_x))
      (then
        (call $set_flags_sub
          (local.get $x1) (local.get $min_x)
          (i32.sub (local.get $x1) (local.get $min_x)))
        (global.set $steps
          (i32.sub (global.get $steps) (i32.sub (local.get $cost) (i32.const 1))))
        (global.set $eip (i32.add (local.get $start) (local.get $reject_off)))
        (return)))

    (local.set $cost (i32.add (local.get $cost) (i32.const 3)))
    (local.set $max_x (i32.load offset=0x5c (local.get $this_wa)))
    (if (i32.eq (local.get $op) (i32.const 1))
      (then (global.set $edx (local.get $max_x)))
      (else (global.set $ecx (local.get $max_x))))
    (if (i32.gt_s (local.get $x0) (local.get $max_x))
      (then
        (call $set_flags_sub
          (local.get $x0) (local.get $max_x)
          (i32.sub (local.get $x0) (local.get $max_x)))
        (global.set $steps
          (i32.sub (global.get $steps) (i32.sub (local.get $cost) (i32.const 1))))
        (global.set $eip (i32.add (local.get $start) (local.get $reject_off)))
        (return)))

    (local.set $cost (i32.add (local.get $cost) (i32.const 2)))
    (if (i32.lt_s (local.get $x0) (local.get $min_x))
      (then
        (i32.store offset=20 (local.get $esp_wa) (local.get $min_x))
        (if (i32.eq (local.get $op) (i32.const 2))
          (then
            (local.set $cost (i32.add (local.get $cost) (i32.const 2)))
            (local.set $x0 (local.get $min_x))
            (global.set $ebx (local.get $x0)))
          (else
            (local.set $cost (i32.add (local.get $cost) (i32.const 1)))))))

    (local.set $cost (i32.add (local.get $cost) (i32.const 2)))
    (if (i32.gt_s (local.get $x1) (local.get $max_x))
      (then
        (local.set $cost (i32.add (local.get $cost) (i32.const 2)))
        (local.set $x1 (local.get $max_x))
        (i32.store offset=24 (local.get $esp_wa) (local.get $x1))
        (global.set $ebp (local.get $x1))))

    (local.set $row_base (i32.load offset=0x3c (local.get $this_wa)))
    (if (i32.eq (local.get $op) (i32.const 1))
      (then
        (local.set $cost (i32.add (local.get $cost) (i32.const 5)))
        (local.set $row (i32.shl (local.get $row) (i32.const 2)))
        (global.set $edi (local.get $row))
        (global.set $eax (local.get $row_base))
        (local.set $row_head (call $gl32 (i32.add (local.get $row_base) (local.get $row))))
        (global.set $ebx (local.get $row_head)))
      (else
        (local.set $cost (i32.add (local.get $cost) (i32.const 4)))
        (local.set $row_head
          (call $gl32
            (i32.add (local.get $row_base) (i32.shl (local.get $row) (i32.const 2)))))
        (global.set $eax (local.get $row_head))))
    (call $set_flags_logic (local.get $row_head))
    (global.set $steps
      (i32.sub (global.get $steps) (i32.sub (local.get $cost) (i32.const 1))))
    (if (i32.eq (local.get $op) (i32.const 1))
      (then
        (if (local.get $row_head)
          (then (global.set $eip (i32.add (local.get $start) (i32.const 0xa7))))
          (else (global.set $eip (i32.add (local.get $start) (i32.const 0x6b))))))
      (else
        (if (local.get $row_head)
          (then (global.set $eip (i32.add (local.get $start) (i32.const 0xaf))))
          (else (global.set $eip (i32.add (local.get $start) (i32.const 0x6a)))))))
    (return_call $branch_end))

  ;; 443: whole 8-bit color-key replacement row. AH is the transparent/key
  ;; byte and AL is its replacement. ESI counts down while EDI advances.
  (func $th_colorkey8_run (param $op i32)
    (local $tp i32) (local $fall i32) (local $back i32)
    (local $ptr i32) (local $count i32) (local $old_count i32)
    (local $old_ptr i32) (local $byte i32) (local $key i32)
    (local $replacement i32) (local $cost i32) (local $iters i32)
    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp) (i32.const 8)))
    (local.set $fall (i32.load (local.get $tp)))
    (local.set $back (i32.load offset=4 (local.get $tp)))
    (local.set $ptr (global.get $edi))
    (local.set $count (global.get $esi))
    (local.set $key
      (i32.and (i32.shr_u (global.get $eax) (i32.const 8)) (i32.const 0xff)))
    (local.set $replacement (i32.and (global.get $eax) (i32.const 0xff)))
    (global.set $loop_colorkey8_runs
      (i32.add (global.get $loop_colorkey8_runs) (i32.const 1)))

    ;; Authentic callers supply a positive row width. Preserve the x86
    ;; do-while behavior for zero without attempting an unbounded 2^32-byte
    ;; fold: execute one element and resume at the original loop head.
    (local.set $iters
      (select (local.get $count) (i32.const 1)
        (i32.ne (local.get $count) (i32.const 0))))
    (block $done
      (loop $bytes
        (local.set $old_ptr (local.get $ptr))
        (local.set $old_count (local.get $count))
        (local.set $byte (call $gl8 (local.get $ptr)))
        ;; CMP + JNE + INC + DEC + JNE always execute; the replacement MOV is
        ;; the sixth instruction only when the compare is equal.
        (local.set $cost (i32.add (local.get $cost) (i32.const 5)))
        (if (i32.eq (local.get $byte) (local.get $key))
          (then
            (call $gs8 (local.get $ptr) (local.get $replacement))
            (local.set $cost (i32.add (local.get $cost) (i32.const 1)))))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        (local.set $count (i32.sub (local.get $count) (i32.const 1)))
        (br_if $done (i32.eqz (local.get $count)))
        ;; Zero entered as a wrapped do-while is deliberately one-at-a-time.
        (br_if $done (i32.eq (local.get $iters) (i32.const 1)))
        (br $bytes)))

    ;; Recreate the last iteration's lazy flags exactly. CMP sets byte-width
    ;; carry; INC EDI preserves it; DEC ESI preserves it again and supplies
    ;; the final ZF/SF/OF state consumed by JNE.
    (drop (call $do_alu_sized (i32.const 7) (local.get $byte) (local.get $key)
      (i32.const 0xff) (i32.const 7)))
    (call $set_flags_inc (local.get $old_ptr) (local.get $ptr))
    (call $set_flags_dec (local.get $old_count) (local.get $count))
    (global.set $edi (local.get $ptr))
    (global.set $esi (local.get $count))
    (global.set $steps
      (i32.sub (global.get $steps) (i32.sub (local.get $cost) (i32.const 1))))
    ;; Each element enters the compare/JNE block and the induction/JNE block.
    ;; The dispatcher already charged the current H443 block entry.
    (global.set $block_budget
      (i32.sub (global.get $block_budget)
        (i32.sub (i32.mul (local.get $iters) (i32.const 2)) (i32.const 1))))
    (global.set $loop_colorkey8_bytes
      (i64.add (global.get $loop_colorkey8_bytes)
        (i64.extend_i32_u (local.get $iters))))
    (global.set $eip
      (select (local.get $back) (local.get $fall)
        (i32.ne (local.get $count) (i32.const 0))))
    (return_call $branch_end))

  ;; ------------------------------------------------------------------
  ;; 418: the universal LUT_RUN super-op.
  ;; ------------------------------------------------------------------
  ;; Both recognizers emit the descriptor documented above. Cursors advance
  ;; after each access; match time folds any original pre-access increment into
  ;; the displacement. term_kind selects count-to-zero or unsigned source-bound
  ;; termination. The optional shift/add pair covers 64K row lookup tables;
  ;; bit 0 adds a second moving byte source for blend tables, bit 1 selects a
  ;; u16 lookup/store, bit 2 loads the table register from the stack, and bit 3
  ;; makes word 6 an absolute byte-table address.
  (func $th_lut_run (param $op i32)
    (local $blend i32) (local $wide16 i32)
    (local $table_stack i32) (local $absolute8 i32)
    (local $src_reg i32) (local $src_stride i32) (local $src_disp i32)
    (local $dst_reg i32) (local $dst_stride i32) (local $dst_disp i32)
    (local $tbl_reg i32) (local $acc_reg i32) (local $index_shift i32)
    (local $add_reg i32) (local $term_kind i32) (local $term_reg i32)
    (local $term_step i32)
    (local $src2_reg i32) (local $src2_stride i32) (local $src2_disp i32)
    (local $aux_reg i32) (local $table_disp i32) (local $term_stream i32)
    (local $stack_disp i32)
    (local $m0_addr i32) (local $m0_reg i32) (local $m0_adj i32)
    (local $m1_addr i32) (local $m1_reg i32) (local $m1_adj i32)
    (local $fall i32) (local $back i32) (local $cost i32)
    (local $tp i32) (local $src i32) (local $src2 i32) (local $dst i32)
    (local $term i32) (local $cursor i32)
    (local $tbl i32) (local $tbl_base i32) (local $stack_ga i32)
    (local $stack_page0 i32) (local $stack_page1 i32)
    (local $add i32) (local $old i32)
    (local $b i32) (local $src_b i32) (local $aux i32)
    (local $src_ga i32) (local $dst_ga i32) (local $src_wa i32) (local $dst_wa i32)
    (local $src2_ga i32) (local $src2_wa i32)
    (local $tbl_wa i32)
    (local $chunk i32) (local $trips i32) (local $allowed i32)
    (local $n i32) (local $index i32) (local $cont i32)

    ;; Read the fixed descriptor off one base. These runs are often short, so
    ;; avoiding 22/28 helper calls matters to the cost this optimization is
    ;; meant to remove.
    (local.set $blend (i32.and (local.get $op) (i32.const 1)))
    (local.set $wide16
      (i32.and (i32.shr_u (local.get $op) (i32.const 1)) (i32.const 1)))
    (local.set $table_stack
      (i32.and (i32.shr_u (local.get $op) (i32.const 2)) (i32.const 1)))
    (local.set $absolute8
      (i32.and (i32.shr_u (local.get $op) (i32.const 3)) (i32.const 1)))
    (local.set $tp (global.get $ip))
    (global.set $ip (i32.add (local.get $tp)
      (select (i32.const 112)
        (select
          (select (i32.const 96) (i32.const 92) (local.get $table_stack))
          (i32.const 88) (local.get $wide16))
        (local.get $blend))))
    (local.set $src_reg     (i32.load           (local.get $tp)))
    (local.set $src_stride  (i32.load offset=4  (local.get $tp)))
    (local.set $src_disp    (i32.load offset=8  (local.get $tp)))
    (local.set $dst_reg     (i32.load offset=12 (local.get $tp)))
    (local.set $dst_stride  (i32.load offset=16 (local.get $tp)))
    (local.set $dst_disp    (i32.load offset=20 (local.get $tp)))
    (local.set $tbl_reg     (i32.load offset=24 (local.get $tp)))
    (local.set $acc_reg     (i32.load offset=28 (local.get $tp)))
    (local.set $index_shift (i32.load offset=32 (local.get $tp)))
    (local.set $add_reg     (i32.load offset=36 (local.get $tp)))
    (local.set $term_kind   (i32.load offset=40 (local.get $tp)))
    (local.set $term_reg    (i32.load offset=44 (local.get $tp)))
    (local.set $term_step   (i32.load offset=48 (local.get $tp)))
    (local.set $m0_addr     (i32.load offset=52 (local.get $tp)))
    (local.set $m0_reg      (i32.load offset=56 (local.get $tp)))
    (local.set $m0_adj      (i32.load offset=60 (local.get $tp)))
    (local.set $m1_addr     (i32.load offset=64 (local.get $tp)))
    (local.set $m1_reg      (i32.load offset=68 (local.get $tp)))
    (local.set $m1_adj      (i32.load offset=72 (local.get $tp)))
    (local.set $fall        (i32.load offset=76 (local.get $tp)))
    (local.set $back        (i32.load offset=80 (local.get $tp)))
    (local.set $cost        (i32.load offset=84 (local.get $tp)))
    (if (local.get $blend)
      (then
        (local.set $src2_reg    (i32.load offset=88  (local.get $tp)))
        (local.set $src2_stride (i32.load offset=92  (local.get $tp)))
        (local.set $src2_disp   (i32.load offset=96  (local.get $tp)))
        (local.set $aux_reg     (i32.load offset=100 (local.get $tp)))
        (local.set $table_disp  (i32.load offset=104 (local.get $tp)))
        (local.set $term_stream (i32.load offset=108 (local.get $tp)))))
    (if (local.get $wide16)
      (then (local.set $table_disp (i32.load offset=88 (local.get $tp)))))
    (if (local.get $table_stack)
      (then (local.set $stack_disp (i32.load offset=92 (local.get $tp)))))

    (local.set $src (call $get_reg (local.get $src_reg)))
    (local.set $dst (call $get_reg (local.get $dst_reg)))
    (local.set $term (call $get_reg (local.get $term_reg)))
    (if (local.get $blend)
      (then (local.set $src2 (call $get_reg (local.get $src2_reg)))))
    (if (local.get $table_stack)
      (then
        (local.set $stack_ga (i32.add (global.get $esp) (local.get $stack_disp)))
        (local.set $stack_page0
          (i32.and (local.get $stack_ga) (i32.const 0xFFFFF000)))
        (local.set $stack_page1
          (i32.and (i32.add (local.get $stack_ga) (i32.const 3))
                   (i32.const 0xFFFFF000)))
        (local.set $tbl_base
          (call $gl32 (local.get $stack_ga)))
        (local.set $tbl (i32.add (local.get $tbl_base) (local.get $table_disp))))
      (else
        (if (local.get $absolute8)
          (then (local.set $tbl (local.get $tbl_reg)))
          (else
            (if (i32.ge_s (local.get $tbl_reg) (i32.const 0))
              (then
                (local.set $tbl_base (call $get_reg (local.get $tbl_reg)))
                (local.set $tbl (i32.add (local.get $tbl_base) (local.get $table_disp))))
              (else (local.set $tbl (local.get $table_disp))))))))
    (if (i32.ge_s (local.get $add_reg) (i32.const 0))
      (then (local.set $add (call $get_reg (local.get $add_reg)))))

    ;; Translate the complete lookup range once when it is the normal affine
    ;; guest window. Version 1 indexes all 64KB; the two-endpoint guard keeps
    ;; sparse mappings on gl8.
    (local.set $tbl_wa (i32.const 0))
    (if (i32.and
          (i32.and (i32.eqz (local.get $blend)) (i32.eqz (local.get $wide16)))
          (i32.and (i32.eqz (local.get $index_shift))
                 (i32.lt_s (local.get $add_reg) (i32.const 0))))
      (then
        (if (i32.le_u (i32.and (local.get $tbl) (i32.const 0xFFF)) (i32.const 0xF00))
          (then
            (local.set $n (call $g2w (local.get $tbl)))
            (if (i32.ne (local.get $n) (global.get $NULL_SENTINEL))
              (then (local.set $tbl_wa (local.get $n))))))))
    ;; A wide table contains 256 u16 entries. Prove its complete 512-byte
    ;; extent once, retaining gl16 for non-affine sparse boundaries.
    (if (i32.and (local.get $wide16) (i32.eqz (local.get $table_stack)))
      (then
        (if (i32.le_u (i32.and (local.get $tbl) (i32.const 0xFFF)) (i32.const 0xE00))
          (then (local.set $tbl_wa (call $g2w (local.get $tbl))))
          (else (local.set $tbl_wa
            (call $g2w_affine_span (local.get $tbl) (i32.const 0x200)))))
        (if (i32.eq (local.get $tbl_wa) (global.get $NULL_SENTINEL))
          (then (local.set $tbl_wa (i32.const 0))))))
    (global.set $loop_lut_runs
      (i32.add (global.get $loop_lut_runs) (i32.const 1)))
    (if (local.get $wide16)
      (then (global.set $loop_lut16_runs
        (i32.add (global.get $loop_lut16_runs) (i32.const 1)))))
    (block $exit
      (loop $outer
        (local.set $src_ga (i32.add (local.get $src) (local.get $src_disp)))
        (local.set $dst_ga (i32.add (local.get $dst) (local.get $dst_disp)))
        ;; The stack-prefixed form semantically reloads the table register at
        ;; the start of every original iteration. A destination page distinct
        ;; from the stack slot proves that load invariant for this page chunk.
        ;; When they can alias below, chunk=1 makes this outer reload happen
        ;; before every store, preserving even self-modifying stack data.
        (if (local.get $table_stack)
          (then
            (local.set $tbl_base (call $gl32 (local.get $stack_ga)))
            (local.set $tbl (i32.add (local.get $tbl_base) (local.get $table_disp)))
            (if (i32.le_u (i32.and (local.get $tbl) (i32.const 0xFFF)) (i32.const 0xE00))
              (then (local.set $tbl_wa (call $g2w (local.get $tbl))))
              (else (local.set $tbl_wa
                (call $g2w_affine_span (local.get $tbl) (i32.const 0x200)))))
            (if (i32.eq (local.get $tbl_wa) (global.get $NULL_SENTINEL))
              (then (local.set $tbl_wa (i32.const 0))))))
        (if (local.get $blend)
          (then (local.set $src2_ga
            (i32.add (local.get $src2) (local.get $src2_disp)))))

        (if (i32.eqz (local.get $term_kind))
          (then
            (local.set $trips
              (select (local.get $term)
                      (i32.sub (i32.const 0) (local.get $term))
                      (i32.eq (local.get $term_step) (i32.const -1))))
            ;; Preserve do-while semantics for a zero/wrapped counter entry.
            (if (i32.eqz (local.get $trips))
              (then (local.set $trips (i32.const -1)))))
          (else
            ;; A normally reached back-edge guarantees src < bound. The one-trip
            ;; fallback preserves the original do-while behavior for a direct
            ;; entry whose precondition is false.
            (local.set $cursor
              (select (local.get $src2) (local.get $src)
                (i32.and (local.get $blend) (local.get $term_stream))))
            (local.set $trips
              (select (i32.sub (local.get $term) (local.get $cursor))
                      (i32.const 1)
                      (i32.lt_u (local.get $cursor) (local.get $term))))))
        (local.set $allowed
          (i32.div_u
            (i32.add
              (select (global.get $steps) (i32.const 0)
                      (i32.gt_s (global.get $steps) (i32.const 0)))
              (i32.sub (local.get $cost) (i32.const 1)))
            (local.get $cost)))
        (if (i32.eqz (local.get $allowed))
          (then (local.set $allowed (i32.const 1))))
        (local.set $chunk
          (select (local.get $trips) (local.get $allowed)
                  (i32.lt_u (local.get $trips) (local.get $allowed))))
        (local.set $n (call $copy_page_room (local.get $src_ga) (local.get $src_stride)))
        (local.set $chunk
          (select (local.get $n) (local.get $chunk)
                  (i32.lt_u (local.get $n) (local.get $chunk))))
        (local.set $n (call $copy_page_room (local.get $dst_ga) (local.get $dst_stride)))
        (local.set $chunk
          (select (local.get $n) (local.get $chunk)
                  (i32.lt_u (local.get $n) (local.get $chunk))))
        (if (i32.and (local.get $table_stack)
              (i32.or
                (i32.or
                  (i32.eq
                    (i32.and (local.get $dst_ga) (i32.const 0xFFFFF000))
                    (local.get $stack_page0))
                  (i32.eq
                    (i32.and (local.get $dst_ga) (i32.const 0xFFFFF000))
                    (local.get $stack_page1)))
                (i32.or
                  (i32.eq
                    (i32.and (i32.add (local.get $dst_ga) (i32.const 1))
                             (i32.const 0xFFFFF000))
                    (local.get $stack_page0))
                  (i32.eq
                    (i32.and (i32.add (local.get $dst_ga) (i32.const 1))
                             (i32.const 0xFFFFF000))
                    (local.get $stack_page1)))))
          (then (local.set $chunk (i32.const 1))))
        (if (local.get $blend)
          (then
            (local.set $n
              (call $copy_page_room (local.get $src2_ga) (local.get $src2_stride)))
            (local.set $chunk
              (select (local.get $n) (local.get $chunk)
                      (i32.lt_u (local.get $n) (local.get $chunk))))))

        (local.set $src_wa (call $g2w (local.get $src_ga)))
        (local.set $dst_wa (call $g2w (local.get $dst_ga)))
        ;; A word beginning at the final byte of a page may cross into a
        ;; different mapping. Route that one element through gs16.
        (if (i32.and (local.get $wide16)
              (i32.eq (i32.and (local.get $dst_ga) (i32.const 0xFFF)) (i32.const 0xFFF)))
          (then
            (local.set $dst_wa (global.get $NULL_SENTINEL))
            (local.set $chunk (i32.const 1))))
        (if (local.get $blend)
          (then (local.set $src2_wa (call $g2w (local.get $src2_ga)))))
        (if (i32.or
              (i32.eq (local.get $src_wa) (global.get $NULL_SENTINEL))
              (i32.or
                (i32.eq (local.get $dst_wa) (global.get $NULL_SENTINEL))
                (i32.and (local.get $blend)
                  (i32.eq (local.get $src2_wa) (global.get $NULL_SENTINEL)))))
          (then (local.set $chunk (i32.const 1))))
        (call $invalidate_code_write
          (i32.and (local.get $dst_ga) (i32.const 0xFFFFF000)) (i32.const 4096))

        (local.set $n (local.get $chunk))
        (loop $inner
          (if (i32.eq (local.get $src_wa) (global.get $NULL_SENTINEL))
            (then (local.set $src_b (call $gl8 (local.get $src_ga))))
            (else (local.set $src_b (i32.load8_u (local.get $src_wa)))))
          (if (local.get $blend)
            (then
              (if (i32.eq (local.get $src2_wa) (global.get $NULL_SENTINEL))
                (then (local.set $aux (call $gl8 (local.get $src2_ga))))
                (else (local.set $aux (i32.load8_u (local.get $src2_wa)))))))
          (local.set $index (i32.shl (local.get $src_b) (local.get $index_shift)))
          (if (local.get $blend)
            (then (local.set $index (i32.add (local.get $index) (local.get $aux))))
            (else (if (i32.ge_s (local.get $add_reg) (i32.const 0))
              (then (local.set $index (i32.add (local.get $index) (local.get $add)))))))
          (if (local.get $wide16)
            (then
              (if (local.get $tbl_wa)
                (then (local.set $b
                  (i32.load16_u (i32.add (local.get $tbl_wa) (local.get $index)))))
                (else (local.set $b
                  (call $gl16 (i32.add (local.get $tbl) (local.get $index))))))
              (if (i32.eq (local.get $dst_wa) (global.get $NULL_SENTINEL))
                (then (call $gs16 (local.get $dst_ga) (local.get $b)))
                (else (i32.store16 (local.get $dst_wa) (local.get $b)))))
            (else
              (if (local.get $tbl_wa)
                (then (local.set $b
                  (i32.load8_u (i32.add (local.get $tbl_wa) (local.get $index)))))
                (else (local.set $b
                  (call $gl8 (i32.add (local.get $tbl) (local.get $index))))))
              (if (i32.eq (local.get $dst_wa) (global.get $NULL_SENTINEL))
                (then (call $gs8 (local.get $dst_ga) (local.get $b)))
                (else (i32.store8 (local.get $dst_wa) (local.get $b))))))
          (local.set $src_ga (i32.add (local.get $src_ga) (local.get $src_stride)))
          (local.set $dst_ga (i32.add (local.get $dst_ga) (local.get $dst_stride)))
          (if (i32.ne (local.get $src_wa) (global.get $NULL_SENTINEL))
            (then (local.set $src_wa (i32.add (local.get $src_wa) (local.get $src_stride)))))
          (if (i32.ne (local.get $dst_wa) (global.get $NULL_SENTINEL))
            (then (local.set $dst_wa (i32.add (local.get $dst_wa) (local.get $dst_stride)))))
          (if (local.get $blend)
            (then
              (local.set $src2_ga
                (i32.add (local.get $src2_ga) (local.get $src2_stride)))
              (if (i32.ne (local.get $src2_wa) (global.get $NULL_SENTINEL))
                (then (local.set $src2_wa
                  (i32.add (local.get $src2_wa) (local.get $src2_stride)))))))
          (local.set $n (i32.sub (local.get $n) (i32.const 1)))
          (br_if $inner (local.get $n)))

        (local.set $src
          (i32.add (local.get $src) (i32.mul (local.get $chunk) (local.get $src_stride))))
        (if (local.get $blend)
          (then (local.set $src2
            (i32.add (local.get $src2)
              (i32.mul (local.get $chunk) (local.get $src2_stride))))))
        (if (i32.eq (local.get $src_reg) (local.get $dst_reg))
          (then (local.set $dst (local.get $src)))
          (else (local.set $dst
            (i32.add (local.get $dst) (i32.mul (local.get $chunk) (local.get $dst_stride))))))
        (if (i32.eqz (local.get $term_kind))
          (then
            (local.set $term
              (i32.add (local.get $term) (i32.mul (local.get $chunk) (local.get $term_step))))
            (local.set $old (i32.sub (local.get $term) (local.get $term_step)))))
        (global.set $loop_lut_bytes
          (i64.add (global.get $loop_lut_bytes) (i64.extend_i32_u (local.get $chunk))))
        (if (local.get $wide16)
          (then (global.set $loop_lut16_bytes
            (i64.add (global.get $loop_lut16_bytes)
              (i64.extend_i32_u (local.get $chunk))))))
        (global.set $steps
          (i32.sub (global.get $steps) (i32.mul (local.get $chunk) (local.get $cost))))
        (local.set $cursor
          (select (local.get $src2) (local.get $src)
            (i32.and (local.get $blend) (local.get $term_stream))))
        (local.set $cont
          (select (i32.ne (local.get $term) (i32.const 0))
                  (i32.lt_u (local.get $cursor) (local.get $term))
                  (i32.eqz (local.get $term_kind))))
        (br_if $exit (i32.eqz (local.get $cont)))
        (br_if $exit (i32.le_s (global.get $steps) (i32.const 0)))
        (br $outer)))

    (call $set_reg (local.get $acc_reg)
      (select
        (i32.or (i32.shl (local.get $src_b) (local.get $index_shift)) (local.get $b))
        (local.get $b)
        (local.get $blend)))
    (if (local.get $table_stack)
      (then (call $set_reg (local.get $tbl_reg) (local.get $tbl_base))))
    (if (local.get $blend)
      (then
        (call $set_reg (local.get $aux_reg) (local.get $aux))
        (call $set_reg (local.get $src2_reg) (local.get $src2))))
    (call $set_reg (local.get $src_reg) (local.get $src))
    (if (i32.ne (local.get $dst_reg) (local.get $src_reg))
      (then (call $set_reg (local.get $dst_reg) (local.get $dst))))
    (if (i32.eqz (local.get $term_kind))
      (then
        (call $set_reg (local.get $term_reg) (local.get $term))
        (if (i32.eq (local.get $term_step) (i32.const -1))
          (then (call $set_flags_dec (local.get $old) (local.get $term)))
          (else (call $set_flags_inc (local.get $old) (local.get $term)))))
      (else
        (call $set_flags_sub (local.get $cursor) (local.get $term)
          (i32.sub (local.get $cursor) (local.get $term)))))
    (if (local.get $m0_addr)
      (then (call $gs32 (local.get $m0_addr)
              (i32.add (call $get_reg (local.get $m0_reg)) (local.get $m0_adj)))))
    (if (local.get $m1_addr)
      (then (call $gs32 (local.get $m1_addr)
              (i32.add (call $get_reg (local.get $m1_reg)) (local.get $m1_adj)))))
    (global.set $eip (select (local.get $back) (local.get $fall) (local.get $cont))))

  ;; ==================================================================
  ;; 454: TREE_FOLD -- the first general decode-time expression fold
  ;; ==================================================================
  ;; docs/tree-fold-design-a.md
  ;;
  ;; Every other family in this file proves ONE idiom and replays it with
  ;; hand-written semantics. This one is different in kind: it recognizes a
  ;; self-loop whose whole interior is full-width integer dataflow, records
  ;; that interior as a compact micro-op array, and executes the array with
  ;; the guest's eight GPRs held in wasm LOCALS. The "shape" is therefore a
  ;; parameter, not a predicate -- the three shapes the census named
  ;; (quake2's span coordinate interleave at ref_soft+0x12570, caesar3's RLE
  ;; token decoder at 0x40fa38, and a plain load/op/store chain) are three
  ;; instances of one descriptor, and so is anything else built from the same
  ;; op set.
  ;;
  ;; What the fold removes, per guest op, is exactly the interpreter overhead:
  ;;   * one $next dispatch (frame setup, stack-limit check, interrupt check,
  ;;     call_indirect -- 193 native instructions per tools/wasm-native.js),
  ;;   * the $ip advance and $read_thread_word for operand words,
  ;;   * $get_reg / $set_reg, two br_tables over the register globals.
  ;; And per iteration it removes one block entry ($eip store, cache lookup,
  ;; $branch_end). It removes NOTHING else: memory still goes through
  ;; $gl32/$gs32 (so translation, page crossing and SMC invalidation are
  ;; unchanged) and flags still go through the real $set_flags_* helpers.
  ;;
  ;; That last choice is deliberate and is the whole answer to the per-FIELD
  ;; flag rule in docs/int-expr-fusion-bench.md. $set_flags_logic writes only
  ;; flag_op/flag_res; $set_flags_shift adds flag_b; $set_flags_add writes all
  ;; four. Materializing "the last flag producer" at exit gets this wrong
  ;; whenever a later op writes a strict subset of an earlier op's fields. We
  ;; do not try: every micro-op calls the same helper the scalar handler would
  ;; have called, in the same order, so the five lazy-flag globals plus
  ;; $saved_cf hold precisely the architectural join at every instant --
  ;; including at a side exit, where the bench doc notes nothing is priced.
  ;; The cost is a handful of global stores per op; the win is that the fold
  ;; cannot be wrong about flags. Shadowing them in locals is the obvious next
  ;; relaxation and is named in the doc.
  ;;
  ;; Terminator: the block's own `dec/inc r` + Jcc, or `cmp r,r` / `cmp r,imm`
  ;; + Jcc, back to the head. Because the terminator's flags are published for
  ;; real, the branch is decided by the ordinary $eval_cc and EVERY condition
  ;; code is exact -- including the CF-preserving DEC, whose $saved_cf comes
  ;; from whichever interior op really last wrote CF.
  ;;
  ;; Eligibility (exact; anything else declines the whole block):
  ;;   * full-register 32-bit ops only -- a partial-register write is not in
  ;;     the table, so movzx/movsx into a byte half and every 8/16-bit form
  ;;     decline rather than being approximated;
  ;;   * no interior flag CONSUMER (adc/sbb/rcl/rcr/setcc/interior Jcc are all
  ;;     absent from the table below, and an unlisted op declines);
  ;;   * memory ops keep source order, so a store followed by a possibly
  ;;     aliasing load needs no rule: nothing is reordered, and the alias is
  ;;     resolved by the same $gl32 the scalar path would have used;
  ;;   * at least $tree_fold_min_ops interior ops, or the entry/exit
  ;;     materialization is not repaid.
  ;;
  ;; OFF by default (test/run.js --tree-fold, tools/bench-loops.js
  ;; --toggle=tree_fold). Like every other decode-time gate it must be set
  ;; before the first decode and on every per-thread instance.

  (global $tree_fold_enabled (mut i32) (i32.const 0))
  (global $tree_fold_min_ops (mut i32) (i32.const 4))
  (global $tree_fold_matches (mut i32) (i32.const 0))
  (global $tree_fold_runs (mut i32) (i32.const 0))
  (global $tree_fold_iters (mut i64) (i64.const 0))
  (global $tree_fold_ops (mut i64) (i64.const 0))
  ;; What the most recent lowering actually put in the descriptor header.
  ;; A fold that runs the right number of iterations while publishing the
  ;; wrong register set looks exactly like a fold that never ran its body,
  ;; and these two are what tell those apart. Test-visible only.
  (global $tree_fold_last_nuops (mut i32) (i32.const 0))
  (global $tree_fold_last_live_out (mut i32) (i32.const 0))
  ;; Why self-loops are declined. A match RATE says nothing about what to relax
  ;; next; this split does, and it is the only thing that turns "2% matched"
  ;; into a work list. Decode-time only, so it costs nothing at run time.
  (global $tree_decl_short (mut i32) (i32.const 0))   ;; fewer than min_ops
  (global $tree_decl_long  (mut i32) (i32.const 0))   ;; more than MAX_UOPS
  (global $tree_decl_term  (mut i32) (i32.const 0))   ;; terminator not dec/cmp+Jcc
  (global $tree_decl_uop   (mut i32) (i32.const 0))   ;; an interior op is not foldable
  ;; The handler index of the interior op that most recently caused a decline.
  ;; One sample, not a histogram -- enough to name the family to widen first.
  (global $tree_decl_uop_fn (mut i32) (i32.const -1))

  ;; A descriptor longer than this is refused outright. $decode_block reserves
  ;; 4096 bytes of headroom past $thread_alloc, and 24 micro-ops is 520 bytes
  ;; of descriptor against a source block of at most ~24 ops -- comfortably
  ;; inside it, and past 24 the run length stops being the thing that pays.
  (global $TREE_FOLD_MAX_UOPS i32 (i32.const 24))
  ;; kind, dst, src-or-subop, immediate, original handler index, extra.
  ;; The sixth word is the one field whose meaning is per-kind: for the SIB
  ;; forms it is the index register and scale (index | scale<<4, index 0xF
  ;; meaning "no index"), which is exactly what a SIB EA needs beyond the base
  ;; register already in `a` and the displacement already in `imm`.
  (global $TREE_UOP_WORDS i32 (i32.const 6))
  (global $LOOP_SUPEROP_TREE i32 (i32.const 454))

  ;; Micro-op kinds. Numbered densely because $th_tree_fold dispatches on them
  ;; with a br_table; adding one means extending that table too.
  (global $TU_MOV_RR  i32 (i32.const 0))   ;; R[d] = R[a]
  (global $TU_MOV_RI  i32 (i32.const 1))   ;; R[d] = imm
  (global $TU_LEA_RO  i32 (i32.const 2))   ;; R[d] = R[a] + imm        (no flags)
  (global $TU_ADD_RR  i32 (i32.const 3))
  (global $TU_ADD_RI  i32 (i32.const 4))
  (global $TU_SUB_RR  i32 (i32.const 5))
  (global $TU_SUB_RI  i32 (i32.const 6))
  (global $TU_AND_RR  i32 (i32.const 7))
  (global $TU_AND_RI  i32 (i32.const 8))
  (global $TU_OR_RR   i32 (i32.const 9))
  (global $TU_OR_RI   i32 (i32.const 10))
  (global $TU_XOR_RR  i32 (i32.const 11))
  (global $TU_XOR_RI  i32 (i32.const 12))
  (global $TU_INC     i32 (i32.const 13))
  (global $TU_DEC     i32 (i32.const 14))
  (global $TU_NEG     i32 (i32.const 15))
  (global $TU_NOT     i32 (i32.const 16))  ;; no flags, exactly as x86 NOT
  (global $TU_SHIFT   i32 (i32.const 17))  ;; R[d] = do_shift32(a, R[d], imm)
  (global $TU_IMUL_RR i32 (i32.const 18))
  (global $TU_IMUL_RI i32 (i32.const 19))  ;; R[d] = R[a] * imm
  (global $TU_LOAD32  i32 (i32.const 20))  ;; R[d] = [R[a] + imm]
  (global $TU_STORE32 i32 (i32.const 21))  ;; [R[a] + imm] = R[d]
  ;; Absolute forms. The decoder folds the whole address into one word at
  ;; decode time, so these need no register at all -- which is also why they
  ;; are strictly cheaper than the base+disp pair and worth their own kind.
  (global $TU_LOAD32_ABS  i32 (i32.const 22))  ;; R[d] = [imm]
  (global $TU_STORE32_ABS i32 (i32.const 23))  ;; [imm] = R[d]
  ;; -- Partial registers -------------------------------------------------
  ;; A sub-register op is an EXTRACT and an INSERT on the 32-bit local, which
  ;; is the whole reason the fold can hold a partial write without giving up
  ;; the register file: `mov al,[esi]` is `r0 = (r0 & ~0xFF) | byte`, and the
  ;; untouched lanes of r0 are simply the bits the insert did not cover. That
  ;; is exact, not an approximation, so the family's old blanket exclusion of
  ;; partial writes was a scope decision rather than a correctness one.
  ;;
  ;; One pair of kinds covers both widths, because the only difference is a
  ;; mask and a sign-shift and both are carried in `b`. `d` and `a` hold the
  ;; index of the CONTAINING 32-bit register (reg8 & 3, since AH..BH live in
  ;; EAX..EBX), and `b`'s lane bits say which byte inside it -- so the generic
  ;; register reads above already fetch the right container and the live-out
  ;; mask needs no special case at all.
  (global $TU_MOV_SUB_RR i32 (i32.const 24))  ;; R_sub[d] = R_sub[a]  (no flags)
  (global $TU_MOV_SUB_RI i32 (i32.const 25))  ;; R_sub[d] = imm       (no flags)
  (global $TU_ALU_SUB_RR i32 (i32.const 26))  ;; R_sub[d] op= R_sub[a]
  (global $TU_ALU_SUB_RI i32 (i32.const 27))  ;; R_sub[d] op= imm
  (global $TU_LOAD8_RO   i32 (i32.const 28))  ;; R8[d] = [R[a] + imm]
  (global $TU_STORE8_RO  i32 (i32.const 29))  ;; [R[a] + imm] = R8[d]
  (global $TU_LOAD8_ABS  i32 (i32.const 30))  ;; R8[d] = [imm]
  (global $TU_STORE8_ABS i32 (i32.const 31))  ;; [imm] = R8[d]
  ;; MOVZX/MOVSX read a byte but write the WHOLE destination, so these two are
  ;; full-width writes with a narrow source and need no lane handling at all.
  (global $TU_MOVZX8_RO  i32 (i32.const 32))  ;; R[d] = zx8 [R[a] + imm]
  (global $TU_MOVSX8_RO  i32 (i32.const 33))  ;; R[d] = sx8 [R[a] + imm]

  ;; Bit layout of the `b` word. Disjoint by construction: the SIB fields and
  ;; the lane/width fields never appear in the same kind except for
  ;; TU_STORE8_SIB, which needs both, and that is exactly why the lane bits sit
  ;; above the scale rather than overlapping it.
  (global $TU_B_LANE_D i32 (i32.const 0x40))   ;; dst is the high byte (AH..BH)
  (global $TU_B_LANE_A i32 (i32.const 0x80))   ;; src is the high byte
  (global $TU_B_ALU_SHIFT i32 (i32.const 8))   ;; 4 bits: the ALU sub-op
  (global $TU_B_WORD   i32 (i32.const 0x1000)) ;; 0 = byte width, 1 = word
  (global $TU_B_IMM8_SHIFT i32 (i32.const 16)) ;; TU_MOV_M8_I_SIB's immediate

  ;; SIB forms. Everything from here up computes an effective address as
  ;; R[a] + R[b & 0xF] << (b >> 4) + imm, with 0xF in either register slot
  ;; meaning "absent" -- the same encoding $sib_ea reads, so the arithmetic is
  ;; the decoder's, not a second opinion about it. Kept contiguous at the end
  ;; so the handler can hoist the EA computation behind one range test.
  (global $TU_FIRST_SIB     i32 (i32.const 34))
  (global $TU_LEA_SIB       i32 (i32.const 34))  ;; R[d] = ea          (no flags)
  (global $TU_LOAD32_SIB    i32 (i32.const 35))  ;; R[d] = [ea]
  (global $TU_STORE32_SIB   i32 (i32.const 36))  ;; [ea] = R[d]
  (global $TU_MOVSX8_SIB    i32 (i32.const 37))  ;; R[d] = sx8 [ea]
  (global $TU_STORE8_SIB    i32 (i32.const 38))  ;; [ea] = R8[d]
  (global $TU_MOV_M8_I_SIB  i32 (i32.const 39))  ;; [ea] = imm8 (in b)

  ;; Classifier out-parameters. Decode-time only and single-threaded per
  ;; instance, so globals are cheaper and clearer than packing five fields
  ;; into an i64 return.
  (global $tu_kind (mut i32) (i32.const 0))
  (global $tu_d    (mut i32) (i32.const 0))
  (global $tu_a    (mut i32) (i32.const 0))
  (global $tu_imm  (mut i32) (i32.const 0))
  (global $tu_fn   (mut i32) (i32.const 0))
  (global $tu_b    (mut i32) (i32.const 0))
  ;; Guest ops this micro-op stands for BEYOND the one $next already bills for
  ;; the emitted handler. Almost always zero. H420 is the exception: it charges
  ;; a step of its own (06b-core-handlers.wat says why -- it swallowed a
  ;; separate SIB-EA dispatch), so a block containing one billed n+1 steps per
  ;; iteration unfolded, and the descriptor's `cost` has to say so or the fold
  ;; silently buys the guest more work per batch than the scalar path did.
  (global $tu_extra (mut i32) (i32.const 0))

  ;; Which 32-bit register CONTAINS this sub-register, and is it the high byte?
  ;;
  ;; The two widths disagree, which is the whole reason these are functions.
  ;; A byte index runs AL CL DL BL AH CH DH BH, so 0..3 are the low bytes of
  ;; EAX..EBX and 4..7 are the HIGH bytes of the same four -- index 5 is CH,
  ;; inside ECX, not anything to do with EBP. A word index runs AX CX DX BX SP
  ;; BP SI DI and is simply the low half of the register with the same number.
  ;; Reading a byte index as if it were a word index is a wrong answer that
  ;; still computes, so the width is passed in rather than inferred.
  (func $tree_sub_reg (param $r i32) (param $fn i32) (result i32)
    (if (result i32) (call $tree_fn_is_word (local.get $fn))
      (then (i32.and (local.get $r) (i32.const 0x7)))
      (else (i32.and (local.get $r) (i32.const 0x3)))))
  (func $tree_sub_hi (param $r i32) (param $fn i32) (result i32)
    (if (result i32) (call $tree_fn_is_word (local.get $fn))
      (then (i32.const 0))
      (else (i32.ge_u (local.get $r) (i32.const 4)))))
  ;; The word-width handlers among the sub-register set: H206/H207 (r16 ALU),
  ;; H210 (mov r16,r16), H236 (mov r16,imm16). Everything else in that set is
  ;; a byte form.
  (func $tree_fn_is_word (param $fn i32) (result i32)
    (i32.or (i32.eq (local.get $fn) (i32.const 206))
    (i32.or (i32.eq (local.get $fn) (i32.const 207))
    (i32.or (i32.eq (local.get $fn) (i32.const 210))
            (i32.eq (local.get $fn) (i32.const 236))))))

  ;; Classify one emitted op as a micro-op. Returns 1 and fills the $tu_*
  ;; globals, or returns 0 -- which declines the entire block. The default is
  ;; decline, so a handler this function has never heard of costs a missed
  ;; lowering and never a wrong one.
  ;;
  ;; Extra operand words are read only inside a branch that has already
  ;; equality-tested the handler index, for the reason spelled out above
  ;; $loop_op_at: the thread stream is a discriminated union keyed by handler,
  ;; and a positional read of +8 is only meaningful once the tag is known.
  (func $tree_uop_classify (param $p i32) (result i32)
    (local $fn i32) (local $op i32) (local $type i32) (local $count i32)
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (global.set $tu_fn (local.get $fn))
    (global.set $tu_d (i32.const 0))
    (global.set $tu_a (i32.const 0))
    (global.set $tu_imm (i32.const 0))
    (global.set $tu_b (i32.const 0))
    (global.set $tu_extra (i32.const 0))

    ;; -- register/immediate: operand = reg, imm32 in the next word ----------
    (if (i32.or (i32.eq (local.get $fn) (i32.const 2))
        (i32.or (i32.eq (local.get $fn) (i32.const 3))
        (i32.or (i32.eq (local.get $fn) (i32.const 4))
        (i32.or (i32.eq (local.get $fn) (i32.const 7))
        (i32.or (i32.eq (local.get $fn) (i32.const 8))
                (i32.eq (local.get $fn) (i32.const 9)))))))
      (then
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (if (i32.eq (local.get $fn) (i32.const 2))
          (then (global.set $tu_kind (global.get $TU_MOV_RI)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 3))
          (then (global.set $tu_kind (global.get $TU_ADD_RI)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 4))
          (then (global.set $tu_kind (global.get $TU_OR_RI)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 7))
          (then (global.set $tu_kind (global.get $TU_AND_RI)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 8))
          (then (global.set $tu_kind (global.get $TU_SUB_RI)) (return (i32.const 1))))
        (global.set $tu_kind (global.get $TU_XOR_RI))
        (return (i32.const 1))))

    ;; -- register/register: operand = dst<<4 | src -------------------------
    (if (i32.or (i32.eq (local.get $fn) (i32.const 11))
        (i32.or (i32.eq (local.get $fn) (i32.const 12))
        (i32.or (i32.eq (local.get $fn) (i32.const 13))
        (i32.or (i32.eq (local.get $fn) (i32.const 16))
        (i32.or (i32.eq (local.get $fn) (i32.const 17))
        (i32.or (i32.eq (local.get $fn) (i32.const 18))
                (i32.eq (local.get $fn) (i32.const 118))))))))
      (then
        (global.set $tu_d (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_a (i32.and (local.get $op) (i32.const 0xF)))
        (if (i32.eq (local.get $fn) (i32.const 11))
          (then (global.set $tu_kind (global.get $TU_MOV_RR)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 12))
          (then (global.set $tu_kind (global.get $TU_ADD_RR)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 13))
          (then (global.set $tu_kind (global.get $TU_OR_RR)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 16))
          (then (global.set $tu_kind (global.get $TU_AND_RR)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 17))
          (then (global.set $tu_kind (global.get $TU_SUB_RR)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 18))
          (then (global.set $tu_kind (global.get $TU_XOR_RR)) (return (i32.const 1))))
        (global.set $tu_kind (global.get $TU_IMUL_RR))
        (return (i32.const 1))))

    ;; -- unary register ----------------------------------------------------
    (if (i32.or (i32.eq (local.get $fn) (i32.const 64))
        (i32.or (i32.eq (local.get $fn) (i32.const 65))
        (i32.or (i32.eq (local.get $fn) (i32.const 66))
                (i32.eq (local.get $fn) (i32.const 67)))))
      (then
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (if (i32.eq (local.get $fn) (i32.const 64))
          (then (global.set $tu_kind (global.get $TU_INC)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 65))
          (then (global.set $tu_kind (global.get $TU_DEC)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 66))
          (then (global.set $tu_kind (global.get $TU_NOT)) (return (i32.const 1))))
        (global.set $tu_kind (global.get $TU_NEG))
        (return (i32.const 1))))

    ;; -- imul r, r, imm : operand = dst<<4|src, imm in the next word --------
    (if (i32.eq (local.get $fn) (i32.const 59))
      (then
        (global.set $tu_kind (global.get $TU_IMUL_RI))
        (global.set $tu_d (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_a (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (return (i32.const 1))))

    ;; -- lea r, [base+disp] : operand = dst<<4|base, disp in the next word --
    (if (i32.eq (local.get $fn) (i32.const 126))
      (then
        (global.set $tu_kind (global.get $TU_LEA_RO))
        (global.set $tu_d (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_a (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (return (i32.const 1))))

    ;; -- generic load/store dword, base+disp --------------------------------
    (if (i32.or (i32.eq (local.get $fn) (i32.const 26))
                (i32.eq (local.get $fn) (i32.const 27)))
      (then
        (global.set $tu_kind
          (select (global.get $TU_LOAD32) (global.get $TU_STORE32)
                  (i32.eq (local.get $fn) (i32.const 26))))
        (global.set $tu_d (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_a (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (return (i32.const 1))))

    ;; -- base-specialized load/store dword (339..354): the base register is
    ;; named by the handler index itself and the operand is the data register.
    ;; Same semantics as 26/27; the decoder picks these to save one br_table.
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 339))
                 (i32.le_u (local.get $fn) (i32.const 346)))
      (then
        (global.set $tu_kind (global.get $TU_LOAD32))
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_a (i32.sub (local.get $fn) (i32.const 339)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (return (i32.const 1))))
    (if (i32.and (i32.ge_u (local.get $fn) (i32.const 347))
                 (i32.le_u (local.get $fn) (i32.const 354)))
      (then
        (global.set $tu_kind (global.get $TU_STORE32))
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_a (i32.sub (local.get $fn) (i32.const 347)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (return (i32.const 1))))

    ;; -- absolute dword load/store: operand = reg, guest address in the next
    ;; word. The decoder resolved the address at decode time, so there is no
    ;; base register to read and nothing here can be wrong about one; the
    ;; address still goes through $gl32/$gs32, so translation, page crossing
    ;; and SMC invalidation are the scalar path's, unchanged.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 20))
                (i32.eq (local.get $fn) (i32.const 21)))
      (then
        (global.set $tu_kind
          (select (global.get $TU_LOAD32_ABS) (global.get $TU_STORE32_ABS)
                  (i32.eq (local.get $fn) (i32.const 20))))
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (return (i32.const 1))))

    ;; -- sub-register ALU and MOV, byte and word -----------------------------
    ;; ADC (2) and SBB (3) are declined here as everywhere else: they READ CF,
    ;; and a fold whose licence is that nothing looks at the flags the ops
    ;; leave behind cannot contain one. Every other sub-op goes through the
    ;; same $do_alu_sized the scalar handler calls, with the same mask and
    ;; sign-shift, so the five lazy-flag fields land exactly where the scalar
    ;; sequence would have left them -- including flag_sign_shift, which is 7
    ;; for a byte op and 15 for a word and is the field a hand-written arm
    ;; would have forgotten.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 153))
        (i32.or (i32.eq (local.get $fn) (i32.const 154))
        (i32.or (i32.eq (local.get $fn) (i32.const 206))
                (i32.eq (local.get $fn) (i32.const 207)))))
      (then
        ;; H207's sub-op sits at bit 4, not bit 8, unlike the other three.
        (local.set $type
          (select
            (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF))
            (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xF))
            (i32.eq (local.get $fn) (i32.const 207))))
        (if (i32.or (i32.eq (local.get $type) (i32.const 2))
                    (i32.eq (local.get $type) (i32.const 3)))
          (then (return (i32.const 0))))
        (if (i32.gt_u (local.get $type) (i32.const 7)) (then (return (i32.const 0))))
        (global.set $tu_b
          (i32.or (i32.shl (local.get $type) (global.get $TU_B_ALU_SHIFT))
                  (select (global.get $TU_B_WORD) (i32.const 0)
                          (i32.ge_u (local.get $fn) (i32.const 206)))))
        (if (i32.or (i32.eq (local.get $fn) (i32.const 153))
                    (i32.eq (local.get $fn) (i32.const 206)))
          (then
            ;; register/register: dst<<4 | src, both sub-register indices.
            (local.set $count (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
            (global.set $tu_d (call $tree_sub_reg (local.get $count) (local.get $fn)))
            (global.set $tu_a
              (call $tree_sub_reg (i32.and (local.get $op) (i32.const 0xF)) (local.get $fn)))
            (global.set $tu_b (i32.or (global.get $tu_b)
              (i32.or (select (global.get $TU_B_LANE_D) (i32.const 0)
                        (call $tree_sub_hi (local.get $count) (local.get $fn)))
                      (select (global.get $TU_B_LANE_A) (i32.const 0)
                        (call $tree_sub_hi (i32.and (local.get $op) (i32.const 0xF))
                                           (local.get $fn))))))
            (global.set $tu_kind (global.get $TU_ALU_SUB_RR))
            (return (i32.const 1))))
        ;; register/immediate: the register is the low nibble, the immediate is
        ;; the next word. H154 masks it to a byte, H207 to a word; the mask is
        ;; applied at run time from the width bit, so store the raw word.
        (local.set $count (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_d (call $tree_sub_reg (local.get $count) (local.get $fn)))
        (global.set $tu_b (i32.or (global.get $tu_b)
          (select (global.get $TU_B_LANE_D) (i32.const 0)
                  (call $tree_sub_hi (local.get $count) (local.get $fn)))))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (global.set $tu_kind (global.get $TU_ALU_SUB_RI))
        (return (i32.const 1))))

    ;; MOV reg8,reg8 / MOV r16,r16 / MOV reg8,imm8 / MOV r16,imm16. No flags.
    ;; H155 bit 8 means the decoder fused a SECOND adjacent byte MOV into the
    ;; same op. That is two register writes from one descriptor slot, which
    ;; this array cannot express, so it declines -- a missed lowering, never a
    ;; half-executed one.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 155))
                (i32.eq (local.get $fn) (i32.const 210)))
      (then
        (if (i32.and (i32.eq (local.get $fn) (i32.const 155))
                     (i32.ne (i32.and (local.get $op) (i32.const 0x100)) (i32.const 0)))
          (then (return (i32.const 0))))
        (local.set $count (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_d (call $tree_sub_reg (local.get $count) (local.get $fn)))
        (global.set $tu_a
          (call $tree_sub_reg (i32.and (local.get $op) (i32.const 0xF)) (local.get $fn)))
        (global.set $tu_b
          (i32.or
            (select (global.get $TU_B_WORD) (i32.const 0)
                    (i32.eq (local.get $fn) (i32.const 210)))
            (i32.or (select (global.get $TU_B_LANE_D) (i32.const 0)
                      (call $tree_sub_hi (local.get $count) (local.get $fn)))
                    (select (global.get $TU_B_LANE_A) (i32.const 0)
                      (call $tree_sub_hi (i32.and (local.get $op) (i32.const 0xF))
                                         (local.get $fn))))))
        (global.set $tu_kind (global.get $TU_MOV_SUB_RR))
        (return (i32.const 1))))
    (if (i32.or (i32.eq (local.get $fn) (i32.const 156))
                (i32.eq (local.get $fn) (i32.const 236)))
      (then
        (local.set $count (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_d (call $tree_sub_reg (local.get $count) (local.get $fn)))
        (global.set $tu_b
          (i32.or
            (select (global.get $TU_B_WORD) (i32.const 0)
                    (i32.eq (local.get $fn) (i32.const 236)))
            (select (global.get $TU_B_LANE_D) (i32.const 0)
                    (call $tree_sub_hi (local.get $count) (local.get $fn)))))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (global.set $tu_kind (global.get $TU_MOV_SUB_RI))
        (return (i32.const 1))))

    ;; -- byte memory: absolute, base+disp, and the two widening loads --------
    ;; H24/H25 carry the reg8 index directly in the operand; H28/H29 and
    ;; H143/H144 carry dst<<4 | base. MOVZX/MOVSX write the whole destination,
    ;; so they are ordinary full-width kinds with a narrow load in front.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 24))
                (i32.eq (local.get $fn) (i32.const 25)))
      (then
        (local.set $count (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_d (i32.and (local.get $count) (i32.const 3)))
        (global.set $tu_b
          (select (global.get $TU_B_LANE_D) (i32.const 0)
                  (i32.ge_u (local.get $count) (i32.const 4))))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (global.set $tu_kind
          (select (global.get $TU_LOAD8_ABS) (global.get $TU_STORE8_ABS)
                  (i32.eq (local.get $fn) (i32.const 24))))
        (return (i32.const 1))))
    (if (i32.or (i32.eq (local.get $fn) (i32.const 28))
                (i32.eq (local.get $fn) (i32.const 29)))
      (then
        (local.set $count (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_d (i32.and (local.get $count) (i32.const 3)))
        (global.set $tu_a (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_b
          (select (global.get $TU_B_LANE_D) (i32.const 0)
                  (i32.ge_u (local.get $count) (i32.const 4))))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (global.set $tu_kind
          (select (global.get $TU_LOAD8_RO) (global.get $TU_STORE8_RO)
                  (i32.eq (local.get $fn) (i32.const 28))))
        (return (i32.const 1))))
    (if (i32.or (i32.eq (local.get $fn) (i32.const 143))
                (i32.eq (local.get $fn) (i32.const 144)))
      (then
        (global.set $tu_d (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
        (global.set $tu_a (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_imm (i32.load offset=8 (local.get $p)))
        (global.set $tu_kind
          (select (global.get $TU_MOVZX8_RO) (global.get $TU_MOVSX8_RO)
                  (i32.eq (local.get $fn) (i32.const 143))))
        (return (i32.const 1))))

    ;; -- byte SIB forms: H400 widening load, H401 byte store, H402 byte
    ;; immediate store. Same info/disp encoding as the dword SIB kinds; H402
    ;; carries its immediate in the OPERAND rather than a word, which is why it
    ;; is the one kind whose immediate rides in `b`.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 400))
        (i32.or (i32.eq (local.get $fn) (i32.const 401))
                (i32.eq (local.get $fn) (i32.const 402))))
      (then
        (local.set $type (i32.load offset=8 (local.get $p)))   ;; info word
        (global.set $tu_a (i32.and (local.get $type) (i32.const 0xF)))
        (global.set $tu_b
          (i32.or (i32.and (i32.shr_u (local.get $type) (i32.const 4)) (i32.const 0xF))
                  (i32.shl (i32.and (i32.shr_u (local.get $type) (i32.const 8)) (i32.const 3))
                           (i32.const 4))))
        (global.set $tu_imm (i32.load offset=12 (local.get $p)))
        (if (i32.eq (local.get $fn) (i32.const 400))
          (then
            (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
            (global.set $tu_kind (global.get $TU_MOVSX8_SIB))
            (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 401))
          (then
            (local.set $count (i32.and (local.get $op) (i32.const 0xF)))
            (global.set $tu_d (i32.and (local.get $count) (i32.const 3)))
            (global.set $tu_b (i32.or (global.get $tu_b)
              (select (global.get $TU_B_LANE_D) (i32.const 0)
                      (i32.ge_u (local.get $count) (i32.const 4)))))
            (global.set $tu_kind (global.get $TU_STORE8_SIB))
            (return (i32.const 1))))
        (global.set $tu_b (i32.or (global.get $tu_b)
          (i32.shl (i32.and (local.get $op) (i32.const 0xFF))
                   (global.get $TU_B_IMM8_SHIFT))))
        (global.set $tu_kind (global.get $TU_MOV_M8_I_SIB))
        (return (i32.const 1))))

    ;; -- SIB forms: operand = the data/dst register, then an info word and a
    ;; displacement word. info = base | index<<4 | scale<<8, with 0xF in either
    ;; register nibble meaning that term is absent -- $sib_ea's encoding, split
    ;; here into `a` (base) and `b` (index | scale<<4) so the handler's EA
    ;; arithmetic reads the same two fields for every SIB kind.
    ;;
    ;; H148 LEA, H389 dword load, H420 dword store. H149 ($th_compute_ea_sib)
    ;; is deliberately NOT here: it computes into $ea_temp and leaves the next
    ;; op to consume it, so folding it would mean modelling a second op's
    ;; hidden input, which is a different argument from this one.
    (if (i32.or (i32.eq (local.get $fn) (i32.const 148))
        (i32.or (i32.eq (local.get $fn) (i32.const 389))
                (i32.eq (local.get $fn) (i32.const 420))))
      (then
        (local.set $type (i32.load offset=8 (local.get $p)))   ;; info word
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_a (i32.and (local.get $type) (i32.const 0xF)))
        (global.set $tu_b
          (i32.or (i32.and (i32.shr_u (local.get $type) (i32.const 4)) (i32.const 0xF))
                  (i32.shl (i32.and (i32.shr_u (local.get $type) (i32.const 8)) (i32.const 3))
                           (i32.const 4))))
        (global.set $tu_imm (i32.load offset=12 (local.get $p)))
        (if (i32.eq (local.get $fn) (i32.const 148))
          (then (global.set $tu_kind (global.get $TU_LEA_SIB)) (return (i32.const 1))))
        (if (i32.eq (local.get $fn) (i32.const 389))
          (then (global.set $tu_kind (global.get $TU_LOAD32_SIB)) (return (i32.const 1))))
        (global.set $tu_kind (global.get $TU_STORE32_SIB))
        (global.set $tu_extra (i32.const 1))
        (return (i32.const 1))))

    ;; -- shift/rotate by an immediate --------------------------------------
    ;; operand = reg | type<<8 | count<<16, count 0xFF meaning CL. CL is
    ;; declined: the count would have to be read out of the local register
    ;; file mid-loop, which is a relaxation, not a correctness question, and
    ;; it is not in this cut. RCL/RCR (types 2/3) are flag CONSUMERS and are
    ;; declined for real -- they read CF, which is what this family forbids.
    (if (i32.eq (local.get $fn) (i32.const 53))
      (then
        (local.set $type (i32.and (i32.shr_u (local.get $op) (i32.const 8)) (i32.const 0xFF)))
        (local.set $count (i32.and (i32.shr_u (local.get $op) (i32.const 16)) (i32.const 0xFF)))
        (if (i32.eq (local.get $count) (i32.const 0xFF)) (then (return (i32.const 0))))
        (if (i32.eqz (i32.or (i32.eq (local.get $type) (i32.const 0))
                     (i32.or (i32.eq (local.get $type) (i32.const 1))
                     (i32.or (i32.eq (local.get $type) (i32.const 4))
                     (i32.or (i32.eq (local.get $type) (i32.const 5))
                     (i32.or (i32.eq (local.get $type) (i32.const 6))
                             (i32.eq (local.get $type) (i32.const 7))))))))
          (then (return (i32.const 0))))
        (global.set $tu_kind (global.get $TU_SHIFT))
        (global.set $tu_d (i32.and (local.get $op) (i32.const 0xF)))
        (global.set $tu_a (local.get $type))
        (global.set $tu_imm (local.get $count))
        (return (i32.const 1))))

    (i32.const 0))

  ;; Does this micro-op kind write MEMORY rather than a register? The live-out
  ;; mask is built from the answer, and getting it wrong in the permissive
  ;; direction is the one mistake that would not show up as a crash: a store
  ;; whose `d` was folded into live_out republishes the data register with the
  ;; value it already held, which is harmless, while a load left OUT of the
  ;; mask silently drops the loaded value at exit. So the list is exact, and it
  ;; is one function rather than an inline test at each site because there are
  ;; now three of those sites and a store kind added to only two of them would
  ;; be a live-lock nobody sees.
  (func $tree_uop_is_store (param $kind i32) (result i32)
    (i32.or (i32.eq (local.get $kind) (global.get $TU_STORE32))
    (i32.or (i32.eq (local.get $kind) (global.get $TU_STORE32_ABS))
    (i32.or (i32.eq (local.get $kind) (global.get $TU_STORE32_SIB))
    (i32.or (i32.eq (local.get $kind) (global.get $TU_STORE8_RO))
    (i32.or (i32.eq (local.get $kind) (global.get $TU_STORE8_ABS))
    (i32.or (i32.eq (local.get $kind) (global.get $TU_STORE8_SIB))
            (i32.eq (local.get $kind) (global.get $TU_MOV_M8_I_SIB)))))))))

  ;; Count a terminator decline and return the decline. Written as a function
  ;; because the terminator has four separate reject sites and a counter
  ;; bumped at three of them is worse than no counter at all.
  (func $tree_decl_term_bump (result i32)
    (global.set $tree_decl_term (i32.add (global.get $tree_decl_term) (i32.const 1)))
    (i32.const 0))

  ;; Recognize a self-loop whose interior is pure full-width integer dataflow
  ;; and lower the whole block to one H454 descriptor.
  ;;
  ;; Two passes over the same ops. The first proves eligibility and computes
  ;; the two counts the descriptor header needs before its body (the micro-op
  ;; count and the live-out register mask); the second emits. Classification
  ;; is a pure function of the op record, so the two passes cannot disagree,
  ;; and rewinding $thread_alloc only after the first pass has committed means
  ;; a decline costs nothing.
  (func $loop_try_tree_fold
    (param $start_eip i32) (param $tstart i32) (result i32)
    (local $n i32) (local $i i32) (local $p i32) (local $fn i32) (local $op i32)
    (local $nuops i32) (local $live_out i32) (local $extra i32)
    (local $term_kind i32) (local $term_a i32) (local $term_b i32)
    (local $term_cc i32) (local $term_uop i32)
    (local $fall i32) (local $back i32)

    (local.set $n (global.get $op_index_n))
    ;; Two terminator ops plus at least $tree_fold_min_ops of interior.
    (if (i32.lt_u (local.get $n)
          (i32.add (global.get $tree_fold_min_ops) (i32.const 2)))
      (then
        (global.set $tree_decl_short
          (i32.add (global.get $tree_decl_short) (i32.const 1)))
        (return (i32.const 0))))
    (local.set $nuops (i32.sub (local.get $n) (i32.const 2)))
    (if (i32.gt_u (local.get $nuops) (global.get $TREE_FOLD_MAX_UOPS))
      (then
        (global.set $tree_decl_long
          (i32.add (global.get $tree_decl_long) (i32.const 1)))
        (return (i32.const 0))))

    ;; -- terminator: the Jcc must close the loop on this block's own entry --
    (local.set $p (call $loop_op_at (i32.sub (local.get $n) (i32.const 1))))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (if (i32.eqz (i32.and (i32.ge_u (local.get $fn) (i32.const 307))
                          (i32.le_u (local.get $fn) (i32.const 322))))
      (then (return (call $tree_decl_term_bump))))
    (local.set $term_cc (i32.sub (local.get $fn) (i32.const 307)))
    (local.set $fall (i32.load offset=8 (local.get $p)))
    (local.set $back (i32.load offset=12 (local.get $p)))
    (if (i32.ne (local.get $back) (local.get $start_eip))
      (then (return (call $tree_decl_term_bump))))

    ;; -- terminator: the flag producer immediately before it ----------------
    (local.set $p (call $loop_op_at (i32.sub (local.get $n) (i32.const 2))))
    (local.set $fn (load.field LoopOp handler (local.get $p)))
    (local.set $op (load.field.memarg LoopOp operand (local.get $p)))
    (if (i32.or (i32.eq (local.get $fn) (i32.const 64))
                (i32.eq (local.get $fn) (i32.const 65)))
      (then
        ;; dec/inc r + Jcc: the counted form.
        (local.set $term_kind (i32.const 0))
        (local.set $term_uop (i32.eq (local.get $fn) (i32.const 64)))
        (local.set $term_a (i32.and (local.get $op) (i32.const 0xF)))
        (local.set $live_out (i32.shl (i32.const 1) (local.get $term_a))))
      (else (if (i32.eq (local.get $fn) (i32.const 19))
        (then
          ;; cmp r,r + Jcc: the cursor-vs-bound form. Writes no register.
          (local.set $term_kind (i32.const 1))
          (local.set $term_a
            (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 0xF)))
          (local.set $term_b (i32.and (local.get $op) (i32.const 0xF))))
        (else (if (i32.eq (local.get $fn) (i32.const 10))
          (then
            ;; cmp r,imm + Jcc.
            (local.set $term_kind (i32.const 2))
            (local.set $term_a (i32.and (local.get $op) (i32.const 0xF)))
            (local.set $term_b (i32.load offset=8 (local.get $p))))
          (else (return (call $tree_decl_term_bump))))))))

    ;; -- pass 1: prove every interior op is a micro-op, collect live-outs ---
    (local.set $i (i32.const 0))
    (block $p1_done
      (loop $p1
        (br_if $p1_done (i32.ge_u (local.get $i) (local.get $nuops)))
        (local.set $p (call $loop_op_at (local.get $i)))
        (if (i32.eqz (call $tree_uop_classify (local.get $p)))
          (then
            (global.set $tree_decl_uop
              (i32.add (global.get $tree_decl_uop) (i32.const 1)))
            (global.set $tree_decl_uop_fn (load.field LoopOp handler (local.get $p)))
            (return (i32.const 0))))
        (local.set $extra (i32.add (local.get $extra) (global.get $tu_extra)))
        ;; A STORE writes memory, not a register; everything else defines its
        ;; destination and must be published at exit.
        (if (i32.eqz (call $tree_uop_is_store (global.get $tu_kind)))
          (then (local.set $live_out
            (i32.or (local.get $live_out)
                    (i32.shl (i32.const 1) (global.get $tu_d))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $p1)))

    (global.set $tree_fold_matches
      (i32.add (global.get $tree_fold_matches) (i32.const 1)))
    (if (i32.eqz (global.get $tree_fold_enabled))
      (then (return (i32.const 0))))
    (global.set $loop_matched_blocks
      (i32.add (global.get $loop_matched_blocks) (i32.const 1)))
    (global.set $tree_fold_last_nuops (local.get $nuops))
    (global.set $tree_fold_last_live_out (local.get $live_out))

    ;; -- pass 2: classify into scratch, THEN rewind and emit ----------------
    ;; The order here is the whole correctness argument. Rewinding
    ;; $thread_alloc to $tstart aims the emitter at the bytes the interior ops
    ;; still occupy, and the descriptor header alone is 48 bytes -- four or
    ;; five ops' worth. Classifying while emitting therefore reads each
    ;; micro-op out of memory the header has already overwritten, and since
    ;; every field decodes to *something*, the result is a body full of
    ;; plausible garbage rather than a failure: the loop runs the right number
    ;; of iterations and computes nothing. So every micro-op is decoded into a
    ;; scratch area first, while the original stream is still intact.
    ;;
    ;; The scratch is the far half of OP_INDEX (word 1024 up; capacity 2048,
    ;; and $TREE_FOLD_MAX_UOPS * $TREE_UOP_WORDS is 120), which is free because
    ;; $op_index_n is reset to zero below and only one op is emitted after it.
    (local.set $i (i32.const 0))
    (block $scan_done
      (loop $scan
        (br_if $scan_done (i32.ge_u (local.get $i) (local.get $nuops)))
        (drop (call $tree_uop_classify (call $loop_op_at (local.get $i))))
        (local.set $p
          (i32.add (global.get $OP_INDEX)
            (i32.shl
              (i32.add (i32.const 1024)
                       (i32.mul (local.get $i) (global.get $TREE_UOP_WORDS)))
              (i32.const 2))))
        (i32.store           (local.get $p) (global.get $tu_kind))
        (i32.store offset=4  (local.get $p) (global.get $tu_d))
        (i32.store offset=8  (local.get $p) (global.get $tu_a))
        (i32.store offset=12 (local.get $p) (global.get $tu_imm))
        (i32.store offset=16 (local.get $p) (global.get $tu_fn))
        (i32.store offset=20 (local.get $p) (global.get $tu_b))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))
    (global.set $thread_alloc (local.get $tstart))
    (global.set $op_index_n (i32.const 0))
    (call $te (global.get $LOOP_SUPEROP_TREE) (i32.const 0))
    (call $te_raw (local.get $nuops))
    (call $te_raw (local.get $live_out))
    (call $te_raw (local.get $term_kind))
    (call $te_raw (local.get $term_a))
    (call $te_raw (local.get $term_b))
    (call $te_raw (local.get $term_cc))
    (call $te_raw (local.get $term_uop))
    (call $te_raw (local.get $fall))
    (call $te_raw (local.get $back))
    ;; The cost the unfolded block billed: one $steps per emitted op, plus
    ;; whatever the ops charged on their own account ($tu_extra -- H420).
    (call $te_raw (i32.add (local.get $n) (local.get $extra)))
    (local.set $i (i32.const 0))
    (block $p2_done
      (loop $p2
        (br_if $p2_done (i32.ge_u (local.get $i) (local.get $nuops)))
        (local.set $p
          (i32.add (global.get $OP_INDEX)
            (i32.shl
              (i32.add (i32.const 1024)
                       (i32.mul (local.get $i) (global.get $TREE_UOP_WORDS)))
              (i32.const 2))))
        (call $te_raw (i32.load           (local.get $p)))
        (call $te_raw (i32.load offset=4  (local.get $p)))
        (call $te_raw (i32.load offset=8  (local.get $p)))
        (call $te_raw (i32.load offset=12 (local.get $p)))
        (call $te_raw (i32.load offset=16 (local.get $p)))
        (call $te_raw (i32.load offset=20 (local.get $p)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $p2)))
    (i32.const 1))

  ;; The super-op. Eight guest registers in locals for the whole run; memory,
  ;; flags and the branch decision through the ordinary helpers.
  (func $th_tree_fold (param $op i32)
    (local $tp i32) (local $up i32) (local $ub i32)
    (local $nuops i32) (local $live_out i32)
    (local $term_kind i32) (local $term_a i32) (local $term_b i32)
    (local $term_cc i32) (local $term_uop i32)
    (local $fall i32) (local $back i32) (local $cost i32)
    (local $r0 i32) (local $r1 i32) (local $r2 i32) (local $r3 i32)
    (local $r4 i32) (local $r5 i32) (local $r6 i32) (local $r7 i32)
    (local $i i32) (local $kind i32) (local $d i32) (local $a i32) (local $imm i32)
    (local $b i32) (local $ea i32)
    (local $sh_d i32) (local $sh_a i32) (local $mask i32) (local $ssh i32)
    (local $va i32) (local $vb i32) (local $vr i32)
    (local $iters i32) (local $allowed i32) (local $budget i32)
    (local $taken i32) (local $old i32) (local $wrote i32)

    (local.set $tp (global.get $ip))
    (local.set $nuops     (i32.load           (local.get $tp)))
    (local.set $live_out  (i32.load offset=4  (local.get $tp)))
    (local.set $term_kind (i32.load offset=8  (local.get $tp)))
    (local.set $term_a    (i32.load offset=12 (local.get $tp)))
    (local.set $term_b    (i32.load offset=16 (local.get $tp)))
    (local.set $term_cc   (i32.load offset=20 (local.get $tp)))
    (local.set $term_uop  (i32.load offset=24 (local.get $tp)))
    (local.set $fall      (i32.load offset=28 (local.get $tp)))
    (local.set $back      (i32.load offset=32 (local.get $tp)))
    (local.set $cost      (i32.load offset=36 (local.get $tp)))
    (local.set $ub (i32.add (local.get $tp) (i32.const 40)))
    (global.set $ip
      (i32.add (local.get $ub)
        (i32.mul (local.get $nuops)
          (i32.shl (global.get $TREE_UOP_WORDS) (i32.const 2)))))

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

    ;; Trip bound. Both meters, exactly as the unfolded loop would have spent
    ;; them: one $steps per guest op ($cost of them per iteration) and one
    ;; $block_budget per back-edge. Whichever runs out first stops the run,
    ;; and the run resumes by re-entering this same block through $back.
    (local.set $allowed
      (i32.div_u
        (i32.add
          (select (global.get $steps) (i32.const 0)
                  (i32.gt_s (global.get $steps) (i32.const 0)))
          (i32.sub (local.get $cost) (i32.const 1)))
        (local.get $cost)))
    (local.set $budget
      (select (global.get $block_budget) (i32.const 0)
              (i32.gt_s (global.get $block_budget) (i32.const 0))))
    (if (i32.lt_u (local.get $budget) (local.get $allowed))
      (then (local.set $allowed (local.get $budget))))
    ;; Never zero: a do-while must run its body at least once, exactly as the
    ;; block would have when $run entered it with the budget already spent.
    (if (i32.eqz (local.get $allowed)) (then (local.set $allowed (i32.const 1))))

    (global.set $tree_fold_runs
      (i32.add (global.get $tree_fold_runs) (i32.const 1)))

    (local.set $iters (i32.const 0))
    (local.set $taken (i32.const 0))
    (block $done
      (loop $trip
        (local.set $i (i32.const 0))
        (local.set $up (local.get $ub))
        (block $body_done
          (loop $body
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
                        (i32.shr_u (local.get $b) (i32.const 4)))))))))

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
                          $k39
                          (local.get $kind)))
                ;; 0 MOV_RR
                (local.set $vr (local.get $vb)) (br $kdone))
                ;; 1 MOV_RI
                (local.set $vr (local.get $imm)) (br $kdone))
                ;; 2 LEA_RO -- LEA never touches flags
                (local.set $vr (i32.add (local.get $vb) (local.get $imm))) (br $kdone))
                ;; 3 ADD_RR
                (local.set $vr (i32.add (local.get $va) (local.get $vb)))
                (call $set_flags_add (local.get $va) (local.get $vb) (local.get $vr))
                (br $kdone))
                ;; 4 ADD_RI
                (local.set $vr (i32.add (local.get $va) (local.get $imm)))
                (call $set_flags_add (local.get $va) (local.get $imm) (local.get $vr))
                (br $kdone))
                ;; 5 SUB_RR
                (local.set $vr (i32.sub (local.get $va) (local.get $vb)))
                (call $set_flags_sub (local.get $va) (local.get $vb) (local.get $vr))
                (br $kdone))
                ;; 6 SUB_RI
                (local.set $vr (i32.sub (local.get $va) (local.get $imm)))
                (call $set_flags_sub (local.get $va) (local.get $imm) (local.get $vr))
                (br $kdone))
                ;; 7 AND_RR
                (local.set $vr (i32.and (local.get $va) (local.get $vb)))
                (call $set_flags_logic (local.get $vr)) (br $kdone))
                ;; 8 AND_RI
                (local.set $vr (i32.and (local.get $va) (local.get $imm)))
                (call $set_flags_logic (local.get $vr)) (br $kdone))
                ;; 9 OR_RR
                (local.set $vr (i32.or (local.get $va) (local.get $vb)))
                (call $set_flags_logic (local.get $vr)) (br $kdone))
                ;; 10 OR_RI
                (local.set $vr (i32.or (local.get $va) (local.get $imm)))
                (call $set_flags_logic (local.get $vr)) (br $kdone))
                ;; 11 XOR_RR
                (local.set $vr (i32.xor (local.get $va) (local.get $vb)))
                (call $set_flags_logic (local.get $vr)) (br $kdone))
                ;; 12 XOR_RI
                (local.set $vr (i32.xor (local.get $va) (local.get $imm)))
                (call $set_flags_logic (local.get $vr)) (br $kdone))
                ;; 13 INC -- preserves CF, which $set_flags_inc reads back out
                ;; of whatever really wrote it last.
                (local.set $vr (i32.add (local.get $va) (i32.const 1)))
                (call $set_flags_inc (local.get $va) (local.get $vr)) (br $kdone))
                ;; 14 DEC
                (local.set $vr (i32.sub (local.get $va) (i32.const 1)))
                (call $set_flags_dec (local.get $va) (local.get $vr)) (br $kdone))
                ;; 15 NEG == SUB 0, src
                (local.set $vr (i32.sub (i32.const 0) (local.get $va)))
                (call $set_flags_sub (i32.const 0) (local.get $va) (local.get $vr))
                (br $kdone))
                ;; 16 NOT -- no flags, exactly as x86
                (local.set $vr (i32.xor (local.get $va) (i32.const -1))) (br $kdone))
                ;; 17 SHIFT -- $do_shift32 owns the flag contract, including
                ;; the count==0 case that writes nothing at all.
                (local.set $vr
                  (call $do_shift32 (local.get $a) (local.get $va) (local.get $imm)))
                (br $kdone))
                ;; 18 IMUL_RR
                (local.set $vr (i32.mul (local.get $va) (local.get $vb)))
                (global.set $flag_op (i32.const 6))
                (global.set $flag_sign_shift (i32.const 31))
                (global.set $flag_b
                  (i64.ne
                    (i64.mul (i64.extend_i32_s (local.get $va))
                             (i64.extend_i32_s (local.get $vb)))
                    (i64.extend_i32_s (local.get $vr))))
                (global.set $flag_res (local.get $vr))
                (br $kdone))
                ;; 19 IMUL_RI
                (local.set $vr (i32.mul (local.get $vb) (local.get $imm)))
                (global.set $flag_op (i32.const 6))
                (global.set $flag_sign_shift (i32.const 31))
                (global.set $flag_b
                  (i64.ne
                    (i64.mul (i64.extend_i32_s (local.get $vb))
                             (i64.extend_i32_s (local.get $imm)))
                    (i64.extend_i32_s (local.get $vr))))
                (global.set $flag_res (local.get $vr))
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
                (local.set $vb
                  (call $do_alu_sized
                    (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT)) (i32.const 0xF))
                    (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (local.get $mask))
                    (i32.and (i32.shr_u (local.get $vb) (local.get $sh_a)) (local.get $mask))
                    (local.get $mask) (local.get $ssh)))
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
                  (call $do_alu_sized
                    (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_ALU_SHIFT)) (i32.const 0xF))
                    (i32.and (i32.shr_u (local.get $va) (local.get $sh_d)) (local.get $mask))
                    (i32.and (local.get $imm) (local.get $mask))
                    (local.get $mask) (local.get $ssh)))
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
              ;; 39 MOV_M8_I_SIB (and the unreachable default). The immediate
              ;; rides in `b` because this handler's operand word IS the byte.
              (call $gs8 (local.get $ea)
                (i32.and (i32.shr_u (local.get $b) (global.get $TU_B_IMM8_SHIFT))
                         (i32.const 0xFF)))
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

        ;; -- terminator ----------------------------------------------------
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
            (local.set $vb (local.get $term_b))
            (if (i32.eq (local.get $term_kind) (i32.const 1))
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
            (call $set_flags_sub (local.get $va) (local.get $vb)
              (i32.sub (local.get $va) (local.get $vb)))))

        (local.set $iters (i32.add (local.get $iters) (i32.const 1)))
        ;; $eval_cc reads the same globals the scalar Jcc would have read, so
        ;; every one of the sixteen conditions is exact here for free.
        (local.set $taken (call $eval_cc (local.get $term_cc)))
        (br_if $done (i32.eqz (local.get $taken)))
        (br_if $done (i32.ge_u (local.get $iters) (local.get $allowed)))
        (br $trip)))

    ;; Exit materialization. The live-out mask is what the descriptor proved
    ;; the body writes; a register outside it holds the value it entered with,
    ;; so publishing it would be a no-op and skipping it is not an omission.
    ;; This runs on BOTH exits -- the terminator falling through and the
    ;; budget-exhausted side exit -- which is the rule the bench doc says it
    ;; never priced.
    (if (i32.and (local.get $live_out) (i32.const 0x01)) (then (global.set $eax (local.get $r0))))
    (if (i32.and (local.get $live_out) (i32.const 0x02)) (then (global.set $ecx (local.get $r1))))
    (if (i32.and (local.get $live_out) (i32.const 0x04)) (then (global.set $edx (local.get $r2))))
    (if (i32.and (local.get $live_out) (i32.const 0x08)) (then (global.set $ebx (local.get $r3))))
    (if (i32.and (local.get $live_out) (i32.const 0x10)) (then (global.set $esp (local.get $r4))))
    (if (i32.and (local.get $live_out) (i32.const 0x20)) (then (global.set $ebp (local.get $r5))))
    (if (i32.and (local.get $live_out) (i32.const 0x40)) (then (global.set $esi (local.get $r6))))
    (if (i32.and (local.get $live_out) (i32.const 0x80)) (then (global.set $edi (local.get $r7))))

    (global.set $tree_fold_iters
      (i64.add (global.get $tree_fold_iters) (i64.extend_i32_u (local.get $iters))))
    (global.set $tree_fold_ops
      (i64.add (global.get $tree_fold_ops)
        (i64.extend_i32_u (i32.mul (local.get $iters) (local.get $cost)))))

    ;; Pacing. $next already billed one step for this H454 dispatch and $run
    ;; already billed one block for entering it, so charge the rest: the
    ;; iterations' worth of guest ops, and the back-edges they took. The
    ;; transfer OUT of the block is charged by $branch_end below, exactly as
    ;; the final not-taken Jcc would have charged it.
    (global.set $steps
      (i32.sub (global.get $steps)
        (i32.sub (i32.mul (local.get $iters) (local.get $cost)) (i32.const 1))))
    (global.set $block_budget
      (i32.sub (global.get $block_budget)
        (i32.sub (local.get $iters) (i32.const 1))))

    ;; A side exit resumes by re-entering this same block: the guest state is
    ;; fully materialized, so the descriptor is re-entered as if the loop had
    ;; simply been interrupted between two iterations -- which it was.
    (global.set $eip (select (local.get $back) (local.get $fall) (local.get $taken)))
    (return_call $branch_end))
