  ;; ===================================================================
  ;; 07d-uop-engine.wat — toyvm-style micro-op tier
  ;; ===================================================================
  ;;
  ;; docs/uop-tier-design.md. One function, one br_table, a loop. A program
  ;; is DATA: a run of i32 words [op, operand...] in $UOP_ARENA, written by
  ;; the lowering (07e-uop-compiler.wat, or by hand from
  ;; tools/uop-engine-bench.js).
  ;;
  ;; Why this shape and not 07c's: tools/wasm-native.js on $th_block_exec
  ;; shows ~110 Ion instructions and 3-4 indirect jumps per micro-op before
  ;; its kind arm runs -- three register br_tables, a field decode, spilled
  ;; "register locals" -- plus a call per op to write the lazy flags. That
  ;; is the threaded handler's cost moved, not removed. Here:
  ;;
  ;;   * an operand word IS the vreg's byte address, so a register read is
  ;;     two loads and no jump. Vregs 0-7 are the guest registers in
  ;;     $REGFILE themselves, so entry/exit/fallback move nothing;
  ;;   * no op calls anything on its fast path;
  ;;   * no op writes flag globals -- the lowering forwards cmp/test+jcc
  ;;     into B* ops and puts an explicit REC only where flags are live at
  ;;     an exit;
  ;;   * memory goes through a WINDOW proved by GUARD or by the first access
  ;;     that misses it ($g2w_affine_span, plus the code-page bitmap for
  ;;     written windows), so a load/store is one subtract, one unsigned
  ;;     compare and the access. A miss re-guards on the page of the address
  ;;     (the stream walked off its window) and only exits if that fails too.
  ;;
  ;; Windows are valid for one $uop_run call only: nothing inside a program
  ;; can change a mapping (any API call is an exit), and every entry starts
  ;; with its windows poisoned again.
  ;;
  ;; Window slot, 16 bytes: +0 lo (guest), +4 span (bytes), +8 delta
  ;; (wasm - guest), +12 rw (1 = stores allowed: no code page inside).
  ;;
  ;; Operand kinds below: d/a/b/s/base/idx = vreg address, i/disp/n/sc = imm,
  ;; w = window slot address, t/x = code address (x = deopt stub).
  ;;
  ;; BUDGET, exactly as threaded code spends it. $branch_end charges one
  ;; block per transfer while the budget is above zero and stops the batch at
  ;; the first transfer that finds it at zero. A program charges one block per
  ;; branch op (B*, JMP, BCC: each is one x86 Jcc/JMP, i.e. one $branch_end)
  ;; and per threaded block end it replaces (page seams, and cuts: a fall into
  ;; an in-loop entry, as a JMP to the next op; none under --branch-clock,
  ;; where a cut is free). Each is preceded by a CHK whose stub, when the
  ;; budget is gone, materializes the flags, TAKES the transfer, and ends in
  ;; EXITB at its target -- threaded code stops the batch after the branch,
  ;; with eip at the target, not before it. EXITB makes the enter op end the
  ;; batch outright. GOTO is layout and charges nothing. On an ordinary exit
  ;; the enter op adds one block back and lets $branch_end charge it, so a
  ;; batch ends on the same guest instruction with the tier on or off -- the
  ;; guest clock is batches, so anything less shifts every timer. A loop that
  ;; threaded code FOLDS (07b) is one block on the historical clock, which a
  ;; program charging trips cannot match; under --branch-clock the fold
  ;; charges its trips too ($bc_fold_charge), and the two agree exactly.
  ;; CLOCK is phase 0's form.

  (global $UOP_EXIT      i32 (i32.const 0))  ;; eip
  (global $UOP_MOVI      i32 (i32.const 1))  ;; d i
  (global $UOP_MOV       i32 (i32.const 2))  ;; d a
  (global $UOP_ADD       i32 (i32.const 3))  ;; d a b
  (global $UOP_SUB       i32 (i32.const 4))
  (global $UOP_AND       i32 (i32.const 5))
  (global $UOP_OR        i32 (i32.const 6))
  (global $UOP_XOR       i32 (i32.const 7))
  (global $UOP_ADDI      i32 (i32.const 8))  ;; d a i
  (global $UOP_ANDI      i32 (i32.const 9))
  (global $UOP_SHLI      i32 (i32.const 10))
  (global $UOP_SHRI      i32 (i32.const 11))
  (global $UOP_SARI      i32 (i32.const 12))
  (global $UOP_LD32      i32 (i32.const 13)) ;; d base disp w x
  (global $UOP_LD8U      i32 (i32.const 14)) ;; d base disp w x
  (global $UOP_LD8UX     i32 (i32.const 15)) ;; d base idx disp w x   base+idx+disp
  (global $UOP_LD16UX2   i32 (i32.const 16)) ;; d base idx disp w x   base+idx*2+disp
  (global $UOP_ST32      i32 (i32.const 17)) ;; s base disp w x
  (global $UOP_ST8       i32 (i32.const 18))
  (global $UOP_ST16      i32 (i32.const 19))
  (global $UOP_MERGE8L   i32 (i32.const 20)) ;; d a b   d = a&~0xFF | b&0xFF
  (global $UOP_BNEZ      i32 (i32.const 21)) ;; a t
  (global $UOP_BEQZ      i32 (i32.const 22)) ;; a t
  (global $UOP_BNE       i32 (i32.const 23)) ;; a b t
  (global $UOP_BLTU      i32 (i32.const 24)) ;; a b t
  (global $UOP_JMP       i32 (i32.const 25)) ;; t
  (global $UOP_GUARD     i32 (i32.const 26)) ;; w base disp len rw x
  (global $UOP_CLOCK     i32 (i32.const 27)) ;; n x
  (global $UOP_REC       i32 (i32.const 28)) ;; op a b res shift   (op/shift imm)
  (global $UOP_LD16U     i32 (i32.const 29)) ;; d base disp w x
  (global $UOP_BGEU      i32 (i32.const 30)) ;; a b t
  (global $UOP_SAVECF    i32 (i32.const 31)) ;; (none) $saved_cf = CF
  ;; Phase 1: the forms the lowering emits.
  ;;   32 LEA d base idx sc disp             d = base + (idx<<sc) + disp
  ;;   33-37 LDX32/LDX16U/LDX16S/LDX8U/LDX8S d base idx sc disp w x
  ;;   38-40 STX32/STX16/STX8                 s base idx sc disp w x
  ;;   41 ORI 42 XORI                         d a i
  ;;   43 SHL 44 SHR 45 SAR 46 MUL            d a b   (count masked by wasm)
  ;;   47 SEXT8 48 SEXT16                     d a
  ;;   49 MERGE16L 50 MERGE8H                 d a b
  ;;   51 BEQ 52 BLT 53 BGE                   a b t   (BLT/BGE signed)
  ;;   54 SLTU                                d a b   d = a <u b
  ;;   55 GETCF                               d       d = CF of the lazy state
  ;;   56 RECF op a b res shift scf           REC plus $saved_cf = scf
  ;;   57 BCC cc t                            branch on $eval_cc of the globals
  ;;   58 CHK x                               exit to x when the budget is gone
  ;;   59 MULOF d a b                         d = signed a*b overflows 32 bits
  ;;   60 EXTH d a                            d = (a >> 8) & 0xFF
  ;;   61 SLT d a b                           d = a <s b
  ;;   62 GOTO t                              jump without spending a block

  ;; The main thread's arena. Each guest thread is its own instance over the
  ;; shared memory and a program names its instance's $reg_base, so every
  ;; instance owns an arena: the main thread $UOP_ARENA, worker N slot N-1 of
  ;; $UOP_THREAD_ARENAS ($init_thread picks).
  (global $UOP_ARENA i32 (region.addr $UOP_ARENA 0))
  (global $UOP_ARENA_SIZE i32 (region.size $UOP_ARENA))
  (global $UOP_THREAD_ARENAS i32 (region.addr $UOP_THREAD_ARENAS 0))
  (global $UOP_THREAD_ARENAS_SIZE i32 (region.size $UOP_THREAD_ARENAS))
  (global $UOP_THREAD_ARENA_STRIDE i32 (i32.const 0x00040000))
  ;; Arena layout, relative to $uop_arena. Programs are bump-allocated from +0
  ;; by the lowering; everything a running program or the installer needs
  ;; besides its code lives in the top $UOP_TAIL bytes. The defaults are the
  ;; main arena's; $uop_set_arena recomputes them.
  (global $UOP_TAIL i32 (i32.const 0x00020000))
  (global $uop_arena      (mut i32) (region.addr $UOP_ARENA 0))
  (global $uop_code_bytes (mut i32) (i32.const 0x000E0000))
  (global $uop_temps_off  (mut i32) (i32.const 0x000E0000)) ;; 4096 x 4 bytes
  (global $uop_wins_off   (mut i32) (i32.const 0x000E4000)) ;; 1024 x 16 bytes
  (global $uop_map_off    (mut i32) (i32.const 0x000E8000)) ;; 4096 x {eip, pc}
  (global $uop_ranges_off (mut i32) (i32.const 0x000F0000)) ;; 4096 x {lo, hi, pc}
  (global $UOP_RANGES_MAX i32 (i32.const 4096))
  (global $UOP_HDR        i32 (i32.const 32))
  (global $uop_guard_fails (mut i32) (i32.const 0))
  (global $uop_reguards    (mut i32) (i32.const 0))

  ;; Tier state. Off by default and per instance: only the instance that
  ;; armed it (run.js --uop, main thread) ever installs, because the arena is
  ;; one region and the programs name that instance's $reg_base.
  (global $uop_enabled (mut i32) (i32.const 0))
  (global $uop_gen     (mut i32) (i32.const 1))
  (global $uop_nranges (mut i32) (i32.const 0))
  ;; Bytes of program code placed since the last flush (07e $uop_compile).
  (global $uop_alloc   (mut i32) (i32.const 0))
  (global $uop_installs (mut i32) (i32.const 0))
  (global $uop_kills    (mut i32) (i32.const 0))
  (global $uop_enters   (mut i32) (i32.const 0))
  ;; Set by EXITB for the enter op that is still on the stack: never live
  ;; across a return to the run loop.
  (global $uop_bexit    (mut i32) (i32.const 0))
  (global $uop_blocks   (mut i64) (i64.const 0))
  (global $uop_head_exits (mut i32) (i32.const 0))
  (global $uop_retired_poor (mut i32) (i32.const 0))

  ;; Prove [lo, lo+len) is one affine mapping and, for a written window, that
  ;; no page in it holds decoded code. Fill the slot and answer 1, or leave it
  ;; empty (span 0 -- every access then misses) and answer 0.
  (func $uop_window_set (param $w i32) (param $lo i32) (param $len i32) (param $rw i32) (result i32)
    (local $wa i32) (local $p i32) (local $end i32)
    (i32.store offset=4 (local.get $w) (i32.const 0))
    (if (i32.eqz (local.get $len)) (then (return (i32.const 0))))
    (local.set $wa (call $g2w_affine_span (local.get $lo) (local.get $len)))
    (if (i32.eq (local.get $wa) (global.get $NULL_SENTINEL))
      (then (return (i32.const 0))))
    (if (local.get $rw)
      (then
        (local.set $end (i32.add (local.get $lo) (i32.sub (local.get $len) (i32.const 1))))
        (local.set $p (local.get $lo))
        (block $ok (loop $pages
          (if (call $code_write_is_code (local.get $p)) (then (return (i32.const 0))))
          (br_if $ok (i32.eq (i32.and (local.get $p) (i32.const 0xFFFFF000))
                             (i32.and (local.get $end) (i32.const 0xFFFFF000))))
          (local.set $p (i32.add (i32.and (local.get $p) (i32.const 0xFFFFF000)) (i32.const 0x1000)))
          (br $pages)))))
    (i32.store (local.get $w) (local.get $lo))
    (i32.store offset=8 (local.get $w) (i32.sub (local.get $wa) (local.get $lo)))
    (i32.store offset=12 (local.get $w) (local.get $rw))
    (i32.store offset=4 (local.get $w) (local.get $len))
    (i32.const 1))

  ;; The slow half of every access: the address left its window. Re-guard on
  ;; the page it is in now (keeping the slot's rw); an access that straddles
  ;; that page is not the fast case at all and answers 0, which exits.
  (func $uop_reguard (param $w i32) (param $ga i32) (param $size i32) (result i32)
    (local $pg i32)
    (global.set $uop_reguards (i32.add (global.get $uop_reguards) (i32.const 1)))
    (local.set $pg (i32.and (local.get $ga) (i32.const 0xFFFFF000)))
    (if (i32.gt_u (i32.add (i32.and (local.get $ga) (i32.const 0xFFF)) (local.get $size))
                  (i32.const 0x1000))
      (then (return (i32.const 0))))
    (call $uop_window_set (local.get $w) (local.get $pg) (i32.const 0x1000)
      (i32.load offset=12 (local.get $w))))

  ;; Run from $pc until an EXIT. $budget is block transfers, spent by every
  ;; branch op; answers what is left. $eip is the only global an EXIT writes:
  ;; the registers were never anywhere but $REGFILE.
  (func $uop_run (param $pc i32) (param $budget i32) (result i32)
    (local $ga i32) (local $w i32) (local $v i32)
    (loop $L
      (block $missx
      (block $miss
      (block $c63 (block $c62 (block $c61 (block $c60 (block $c59 (block $c58 (block $c57 (block $c56
      (block $c55 (block $c54 (block $c53 (block $c52 (block $c51 (block $c50
      (block $c49 (block $c48 (block $c47 (block $c46 (block $c45 (block $c44
      (block $c43 (block $c42 (block $c41 (block $c40 (block $c39 (block $c38
      (block $c37 (block $c36 (block $c35 (block $c34 (block $c33 (block $c32
      (block $c31 (block $c30 (block $c29 (block $c28 (block $c27 (block $c26 (block $c25
      (block $c24 (block $c23 (block $c22 (block $c21 (block $c20 (block $c19
      (block $c18 (block $c17 (block $c16 (block $c15 (block $c14 (block $c13
      (block $c12 (block $c11 (block $c10 (block $c9 (block $c8 (block $c7
      (block $c6 (block $c5 (block $c4 (block $c3 (block $c2 (block $c1 (block $c0
        (br_table $c0 $c1 $c2 $c3 $c4 $c5 $c6 $c7 $c8 $c9 $c10 $c11 $c12 $c13
                  $c14 $c15 $c16 $c17 $c18 $c19 $c20 $c21 $c22 $c23 $c24 $c25
                  $c26 $c27 $c28 $c29 $c30 $c31 $c32 $c33 $c34 $c35 $c36 $c37
                  $c38 $c39 $c40 $c41 $c42 $c43 $c44 $c45 $c46 $c47 $c48 $c49
                  $c50 $c51 $c52 $c53 $c54 $c55 $c56 $c57 $c58 $c59 $c60 $c61 $c62 $c63
                  $c0
                  (i32.load (local.get $pc))))
        ;; 0 EXIT eip
        (global.set $eip (i32.load offset=4 (local.get $pc)))
        (return (local.get $budget)))
        ;; 1 MOVI d i
        (i32.store (i32.load offset=4 (local.get $pc)) (i32.load offset=8 (local.get $pc)))
        (local.set $pc (i32.add (local.get $pc) (i32.const 12))) (br $L))
        ;; 2 MOV d a
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load (i32.load offset=8 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 12))) (br $L))
        ;; 3 ADD d a b
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 4 SUB
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.sub (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 5 AND
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.and (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 6 OR
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.or (i32.load (i32.load offset=8 (local.get $pc)))
                  (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 7 XOR
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.xor (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 8 ADDI d a i
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 9 ANDI
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.and (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 10 SHLI
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.shl (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 11 SHRI
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.shr_u (i32.load (i32.load offset=8 (local.get $pc)))
                     (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 12 SARI
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.shr_s (i32.load (i32.load offset=8 (local.get $pc)))
                     (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 13 LD32 d base disp w x
        (local.set $ga (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                (i32.load offset=12 (local.get $pc))))
        (local.set $w (i32.load offset=16 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 4)))
          (then (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 4))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 14 LD8U d base disp w x
        (local.set $ga (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                (i32.load offset=12 (local.get $pc))))
        (local.set $w (i32.load offset=16 (local.get $pc)))
        (if (i32.ge_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.load offset=4 (local.get $w)))
          (then (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 1))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load8_u (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 15 LD8UX d base idx disp w x
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.load (i32.load offset=12 (local.get $pc))))
                                (i32.load offset=16 (local.get $pc))))
        (local.set $w (i32.load offset=20 (local.get $pc)))
        (if (i32.ge_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.load offset=4 (local.get $w)))
          (then (local.set $pc (i32.add (local.get $pc) (i32.const 4)))
                (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 1))))
                (local.set $pc (i32.sub (local.get $pc) (i32.const 4)))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load8_u (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 28))) (br $L))
        ;; 16 LD16UX2 d base idx disp w x
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.const 1)))
                                (i32.load offset=16 (local.get $pc))))
        (local.set $w (i32.load offset=20 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 2)))
          (then (local.set $pc (i32.add (local.get $pc) (i32.const 4)))
                (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 2))))
                (local.set $pc (i32.sub (local.get $pc) (i32.const 4)))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load16_u (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 28))) (br $L))
        ;; 17 ST32 s base disp w x
        (local.set $ga (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                (i32.load offset=12 (local.get $pc))))
        (local.set $w (i32.load offset=16 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 4)))
          (then (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 4))))))
        (i32.store (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))
          (i32.load (i32.load offset=4 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 18 ST8 s base disp w x
        (local.set $ga (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                (i32.load offset=12 (local.get $pc))))
        (local.set $w (i32.load offset=16 (local.get $pc)))
        (if (i32.ge_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.load offset=4 (local.get $w)))
          (then (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 1))))))
        (i32.store8 (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))
          (i32.load (i32.load offset=4 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 19 ST16 s base disp w x
        (local.set $ga (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                (i32.load offset=12 (local.get $pc))))
        (local.set $w (i32.load offset=16 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 2)))
          (then (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 2))))))
        (i32.store16 (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))
          (i32.load (i32.load offset=4 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 20 MERGE8L d a b
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.or (i32.and (i32.load (i32.load offset=8 (local.get $pc))) (i32.const 0xFFFFFF00))
                  (i32.and (i32.load (i32.load offset=12 (local.get $pc))) (i32.const 0xFF))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 21 BNEZ a t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=8 (local.get $pc)) (i32.add (local.get $pc) (i32.const 12))
                  (i32.load (i32.load offset=4 (local.get $pc)))))
        (br $L))
        ;; 22 BEQZ a t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.add (local.get $pc) (i32.const 12)) (i32.load offset=8 (local.get $pc))
                  (i32.load (i32.load offset=4 (local.get $pc)))))
        (br $L))
        ;; 23 BNE a b t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=12 (local.get $pc)) (i32.add (local.get $pc) (i32.const 16))
                  (i32.ne (i32.load (i32.load offset=4 (local.get $pc)))
                          (i32.load (i32.load offset=8 (local.get $pc))))))
        (br $L))
        ;; 24 BLTU a b t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=12 (local.get $pc)) (i32.add (local.get $pc) (i32.const 16))
                  (i32.lt_u (i32.load (i32.load offset=4 (local.get $pc)))
                            (i32.load (i32.load offset=8 (local.get $pc))))))
        (br $L))
        ;; 25 JMP t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc (i32.load offset=4 (local.get $pc)))
        (br $L))
        ;; 26 GUARD w base disp len rw x
        (if (call $uop_window_set (i32.load offset=4 (local.get $pc))
              (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                       (i32.load offset=12 (local.get $pc)))
              (i32.load offset=16 (local.get $pc))
              (i32.load offset=20 (local.get $pc)))
          (then (local.set $pc (i32.add (local.get $pc) (i32.const 28))) (br $L)))
        (global.set $uop_guard_fails (i32.add (global.get $uop_guard_fails) (i32.const 1)))
        (local.set $pc (i32.load offset=24 (local.get $pc)))
        (br $L))
        ;; 27 CLOCK n x
        (local.set $budget (i32.sub (local.get $budget) (i32.load offset=4 (local.get $pc))))
        (local.set $pc
          (select (i32.add (local.get $pc) (i32.const 12)) (i32.load offset=8 (local.get $pc))
                  (i32.gt_s (local.get $budget) (i32.const 0))))
        (br $L))
        ;; 28 REC op a b res shift
        (global.set $flag_op (i32.load offset=4 (local.get $pc)))
        (global.set $flag_a (i32.load (i32.load offset=8 (local.get $pc))))
        (global.set $flag_b (i32.load (i32.load offset=12 (local.get $pc))))
        (global.set $flag_res (i32.load (i32.load offset=16 (local.get $pc))))
        (global.set $flag_sign_shift (i32.load offset=20 (local.get $pc)))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 29 LD16U d base disp w x
        (local.set $ga (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                (i32.load offset=12 (local.get $pc))))
        (local.set $w (i32.load offset=16 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 2)))
          (then (br_if $miss (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 2))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load16_u (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 30 BGEU a b t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=12 (local.get $pc)) (i32.add (local.get $pc) (i32.const 16))
                  (i32.ge_u (i32.load (i32.load offset=4 (local.get $pc)))
                            (i32.load (i32.load offset=8 (local.get $pc))))))
        (br $L))
        ;; 31 SAVECF
        (global.set $saved_cf (call $get_cf))
        (local.set $pc (i32.add (local.get $pc) (i32.const 4))) (br $L))
        ;; 32 LEA d base idx sc disp
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                            (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                     (i32.load offset=16 (local.get $pc))))
                   (i32.load offset=20 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 24))) (br $L))
        ;; 33 LDX32 d base idx sc disp w x
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 4)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 4))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 34 LDX16U
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 2)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 2))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load16_u (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 35 LDX16S
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 2)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 2))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load16_s (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 36 LDX8U
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.ge_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.load offset=4 (local.get $w)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 1))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load8_u (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 37 LDX8S
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.ge_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.load offset=4 (local.get $w)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 1))))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.load8_s (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 38 STX32 s base idx sc disp w x
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 4)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 4))))))
        (i32.store (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))
          (i32.load (i32.load offset=4 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 39 STX16
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.gt_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.sub (i32.load offset=4 (local.get $w)) (i32.const 2)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 2))))))
        (i32.store16 (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))
          (i32.load (i32.load offset=4 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 40 STX8
        (local.set $ga (i32.add (i32.add (i32.load (i32.load offset=8 (local.get $pc)))
                                         (i32.shl (i32.load (i32.load offset=12 (local.get $pc)))
                                                  (i32.load offset=16 (local.get $pc))))
                                (i32.load offset=20 (local.get $pc))))
        (local.set $w (i32.load offset=24 (local.get $pc)))
        (if (i32.ge_u (i32.sub (local.get $ga) (i32.load (local.get $w)))
                      (i32.load offset=4 (local.get $w)))
          (then (br_if $missx (i32.eqz (call $uop_reguard (local.get $w) (local.get $ga) (i32.const 1))))))
        (i32.store8 (i32.add (local.get $ga) (i32.load offset=8 (local.get $w)))
          (i32.load (i32.load offset=4 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 32))) (br $L))
        ;; 41 ORI d a i
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.or (i32.load (i32.load offset=8 (local.get $pc)))
                  (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 42 XORI d a i
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.xor (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load offset=12 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 43 SHL d a b
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.shl (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 44 SHR
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.shr_u (i32.load (i32.load offset=8 (local.get $pc)))
                     (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 45 SAR
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.shr_s (i32.load (i32.load offset=8 (local.get $pc)))
                     (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 46 MUL
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.mul (i32.load (i32.load offset=8 (local.get $pc)))
                   (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 47 SEXT8 d a
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.extend8_s (i32.load (i32.load offset=8 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 12))) (br $L))
        ;; 48 SEXT16 d a
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.extend16_s (i32.load (i32.load offset=8 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 12))) (br $L))
        ;; 49 MERGE16L d a b
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.or (i32.and (i32.load (i32.load offset=8 (local.get $pc))) (i32.const 0xFFFF0000))
                  (i32.and (i32.load (i32.load offset=12 (local.get $pc))) (i32.const 0xFFFF))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 50 MERGE8H d a b   d = a&~0xFF00 | (b&0xFF)<<8
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.or (i32.and (i32.load (i32.load offset=8 (local.get $pc))) (i32.const 0xFFFF00FF))
                  (i32.shl (i32.and (i32.load (i32.load offset=12 (local.get $pc))) (i32.const 0xFF))
                           (i32.const 8))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 51 BEQ a b t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=12 (local.get $pc)) (i32.add (local.get $pc) (i32.const 16))
                  (i32.eq (i32.load (i32.load offset=4 (local.get $pc)))
                          (i32.load (i32.load offset=8 (local.get $pc))))))
        (br $L))
        ;; 52 BLT a b t (signed)
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=12 (local.get $pc)) (i32.add (local.get $pc) (i32.const 16))
                  (i32.lt_s (i32.load (i32.load offset=4 (local.get $pc)))
                            (i32.load (i32.load offset=8 (local.get $pc))))))
        (br $L))
        ;; 53 BGE a b t (signed)
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=12 (local.get $pc)) (i32.add (local.get $pc) (i32.const 16))
                  (i32.ge_s (i32.load (i32.load offset=4 (local.get $pc)))
                            (i32.load (i32.load offset=8 (local.get $pc))))))
        (br $L))
        ;; 54 SLTU d a b
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.lt_u (i32.load (i32.load offset=8 (local.get $pc)))
                    (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 55 GETCF d
        (i32.store (i32.load offset=4 (local.get $pc)) (call $get_cf))
        (local.set $pc (i32.add (local.get $pc) (i32.const 8))) (br $L))
        ;; 56 RECF op a b res shift scf
        (global.set $flag_op (i32.load offset=4 (local.get $pc)))
        (global.set $flag_a (i32.load (i32.load offset=8 (local.get $pc))))
        (global.set $flag_b (i32.load (i32.load offset=12 (local.get $pc))))
        (global.set $flag_res (i32.load (i32.load offset=16 (local.get $pc))))
        (global.set $flag_sign_shift (i32.load offset=20 (local.get $pc)))
        (global.set $saved_cf (i32.load (i32.load offset=24 (local.get $pc))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 28))) (br $L))
        ;; 57 BCC cc t
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $pc
          (select (i32.load offset=8 (local.get $pc)) (i32.add (local.get $pc) (i32.const 12))
                  (call $eval_cc (i32.load offset=4 (local.get $pc)))))
        (br $L))
        ;; 58 CHK x -- just before a charged transfer: with no budget left
        ;; threaded code stops at that transfer, so exit to it (x re-runs the
        ;; branch in threaded code, whose $branch_end then ends the batch).
        (local.set $pc
          (select (i32.add (local.get $pc) (i32.const 8)) (i32.load offset=4 (local.get $pc))
                  (i32.gt_s (local.get $budget) (i32.const 0))))
        (br $L))
        ;; 59 MULOF d a b
        (local.set $v (i32.mul (i32.load (i32.load offset=8 (local.get $pc)))
                               (i32.load (i32.load offset=12 (local.get $pc)))))
        (i32.store (i32.load offset=4 (local.get $pc))
          (i64.ne (i64.mul (i64.extend_i32_s (i32.load (i32.load offset=8 (local.get $pc))))
                           (i64.extend_i32_s (i32.load (i32.load offset=12 (local.get $pc)))))
                  (i64.extend_i32_s (local.get $v))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 60 EXTH d a
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.and (i32.shr_u (i32.load (i32.load offset=8 (local.get $pc))) (i32.const 8))
                   (i32.const 0xFF)))
        (local.set $pc (i32.add (local.get $pc) (i32.const 12))) (br $L))
        ;; 61 SLT d a b
        (i32.store (i32.load offset=4 (local.get $pc))
          (i32.lt_s (i32.load (i32.load offset=8 (local.get $pc)))
                    (i32.load (i32.load offset=12 (local.get $pc)))))
        (local.set $pc (i32.add (local.get $pc) (i32.const 16))) (br $L))
        ;; 62 GOTO t -- a layout jump: no x86 transfer, no block spent
        (local.set $pc (i32.load offset=4 (local.get $pc)))
        (br $L))
        ;; 63 EXITB eip -- the budget ran out at a charged transfer: threaded
        ;; code stops the batch AT ITS TARGET ($branch_end finding zero), so
        ;; the stub has already taken the branch and names where it went.
        (global.set $eip (i32.load offset=4 (local.get $pc)))
        (global.set $uop_bexit (i32.const 1))
        (return (i32.const 0)))
      ;; A memory op whose re-guard failed: its deopt stub. Every memory op
      ;; keeps x at offset 20 (5-operand forms) -- the 6-operand LD*X forms
      ;; step $pc by one word before branching here so the same load reads it.
      (local.set $pc (i32.load offset=20 (local.get $pc)))
      (br $L))
      ;; The 7-operand LDX/STX forms keep x at offset 28.
      (local.set $pc (i32.load offset=28 (local.get $pc)))
      (br $L))
    (unreachable))

  ;; ===================================================================
  ;; Installation. A program header, 32 bytes, precedes its code:
  ;;   +0 gen   ($uop_gen at install; a killed program holds 0)
  ;;   +4 head  (the guest EIP it is entered at)
  ;;   +8 nwin  +12 first window slot address
  ;;   +16 entries  +20 blocks spent in it  (stats, and the retire policy)
  ;;   +24 exits back to the head          +28 reserved
  ;; ===================================================================

  (func $uop_map_slot (param $eip i32) (result i32)
    (i32.add (i32.add (global.get $uop_arena) (global.get $uop_map_off))
      (i32.shl (i32.and (i32.xor (local.get $eip) (i32.shr_u (local.get $eip) (i32.const 12)))
                        (i32.const 4095))
               (i32.const 3))))

  ;; The program to enter at $eip, or 0. Asked once per decoded block by
  ;; $decode_block when the tier is on.
  (func $uop_map_get (param $eip i32) (result i32)
    (local $s i32) (local $pc i32)
    (local.set $s (call $uop_map_slot (local.get $eip)))
    (if (i32.ne (i32.load (local.get $s)) (local.get $eip)) (then (return (i32.const 0))))
    (local.set $pc (i32.load offset=4 (local.get $s)))
    ;; 0 = nothing here, 1 = retired as poor (see $uop_retire_poor).
    (if (i32.le_u (local.get $pc) (i32.const 1)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load (local.get $pc)) (global.get $uop_gen)) (then (return (i32.const 0))))
    (local.get $pc))

  ;; The hot-head hook: $bx_hot_bump calls this instead of the block
  ;; executor's walk when the tier is armed. The lowering (07e) answers the
  ;; program address or 0; everything it wrote is data in $UOP_ARENA.
  (func $uop_try (param $eip i32)
    (local $pc i32)
    (if (i32.ne (call $uop_map_get (local.get $eip)) (i32.const 0)) (then (return)))
    (local.set $pc (call $uop_map_slot (local.get $eip)))
    (if (i32.and (i32.eq (i32.load (local.get $pc)) (local.get $eip))
                 (i32.eq (i32.load offset=4 (local.get $pc)) (i32.const 1)))
      (then (return)))
    (local.set $pc (call $uop_compile (local.get $eip)))
    (if (i32.eqz (local.get $pc))
      (then (call $uop_mark_dead (local.get $eip)) (return)))
    ;; another thread is compiling: try again at the next hot bump
    (if (i32.eq (local.get $pc) (i32.const 1)) (then (return)))
    (call $uop_install (local.get $eip) (local.get $pc)))

  ;; Remember a head the lowering declined: it is a function of the code
  ;; bytes, so asking again at every hot bump only buys another decline.
  ;; Never over a live program of another head that shares the slot.
  ;; $uop_flush_all (the code itself may have changed) forgets every marker.
  (func $uop_mark_dead (param $eip i32)
    (local $s i32) (local $pc i32)
    (local.set $s (call $uop_map_slot (local.get $eip)))
    (local.set $pc (i32.load offset=4 (local.get $s)))
    (if (i32.gt_u (local.get $pc) (i32.const 1))
      (then (if (i32.eq (i32.load (local.get $pc)) (global.get $uop_gen)) (then (return)))))
    (i32.store (local.get $s) (local.get $eip))
    (i32.store offset=4 (local.get $s) (i32.const 1)))

  (func $uop_install (param $eip i32) (param $pc i32)
    (i32.store (local.get $pc) (global.get $uop_gen))
    (i32.store offset=4 (local.get $pc) (local.get $eip))
    (i32.store (call $uop_map_slot (local.get $eip)) (local.get $eip))
    (i32.store offset=4 (call $uop_map_slot (local.get $eip)) (local.get $pc))
    (global.set $uop_installs (i32.add (global.get $uop_installs) (i32.const 1)))
    (call $page_retire_ga (local.get $eip)))

  ;; The lowering registers the guest byte ranges a program was lowered from, so
  ;; a write to any of them kills it. Pages are marked as code so the write
  ;; reaches $invalidate_code_range at all.
  (func $uop_add_range (param $lo i32) (param $hi i32) (param $pc i32) (result i32)
    (local $e i32) (local $p i32)
    (if (i32.ge_u (global.get $uop_nranges) (global.get $UOP_RANGES_MAX))
      (then (return (i32.const 0))))
    (local.set $e (i32.add (i32.add (global.get $uop_arena) (global.get $uop_ranges_off))
                           (i32.mul (global.get $uop_nranges) (i32.const 12))))
    (i32.store (local.get $e) (local.get $lo))
    (i32.store offset=4 (local.get $e) (local.get $hi))
    (i32.store offset=8 (local.get $e) (local.get $pc))
    (global.set $uop_nranges (i32.add (global.get $uop_nranges) (i32.const 1)))
    (local.set $p (i32.and (local.get $lo) (i32.const 0xFFFFF000)))
    (block $d (loop $l
      (br_if $d (i32.ge_u (local.get $p) (local.get $hi)))
      (call $code_page_mark (local.get $p))
      (local.set $p (i32.add (local.get $p) (i32.const 0x1000)))
      (br $l)))
    (i32.const 1))

  ;; A program entered often that does almost nothing per entry costs more
  ;; than it saves, and the head is just as poor the next time it gets hot:
  ;; kill it and leave a marker (pc 1) so $uop_try does not compile it again.
  ;; A kill for a code write clears the slot instead -- new code, new chance.
  (func $uop_retire_poor (param $pc i32)
    (local $s i32)
    (local.set $s (call $uop_map_slot (i32.load offset=4 (local.get $pc))))
    (call $uop_kill (local.get $pc))
    (call $uop_drop_ranges (local.get $pc))
    (if (i32.eq (i32.load (local.get $s)) (i32.load offset=4 (local.get $pc)))
      (then (i32.store offset=4 (local.get $s) (i32.const 1)))))

  (func $uop_kill (param $pc i32)
    (local $s i32)
    (if (i32.eqz (i32.load (local.get $pc))) (then (return)))
    (global.set $uop_kills (i32.add (global.get $uop_kills) (i32.const 1)))
    (local.set $s (call $uop_map_slot (i32.load offset=4 (local.get $pc))))
    (if (i32.eq (i32.load offset=4 (local.get $s)) (local.get $pc))
      (then (i32.store offset=4 (local.get $s) (i32.const 0))))
    (i32.store (local.get $pc) (i32.const 0)))

  ;; Called from $invalidate_code_range for every guest write that reached
  ;; code: kill every program lowered from a byte in [ga, ga+len).
  (func $uop_code_write (param $ga i32) (param $len i32)
    (local $i i32) (local $e i32) (local $end i32) (local $last i32)
    (local.set $end (i32.add (local.get $ga) (local.get $len)))
    (block $d (loop $l
      (br_if $d (i32.ge_u (local.get $i) (global.get $uop_nranges)))
      (local.set $e (i32.add (i32.add (global.get $uop_arena) (global.get $uop_ranges_off))
                             (i32.mul (local.get $i) (i32.const 12))))
      (if (i32.and (i32.lt_u (local.get $ga) (i32.load offset=4 (local.get $e)))
                   (i32.gt_u (local.get $end) (i32.load (local.get $e))))
        (then
          (call $uop_kill (i32.load offset=8 (local.get $e)))
          ;; swap-remove, and look at slot $i again
          (global.set $uop_nranges (i32.sub (global.get $uop_nranges) (i32.const 1)))
          (local.set $last (i32.add (i32.add (global.get $uop_arena) (global.get $uop_ranges_off))
                                    (i32.mul (global.get $uop_nranges) (i32.const 12))))
          (i32.store (local.get $e) (i32.load (local.get $last)))
          (i32.store offset=4 (local.get $e) (i32.load offset=4 (local.get $last)))
          (i32.store offset=8 (local.get $e) (i32.load offset=8 (local.get $last)))
          (br $l)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l))))

  ;; A dead program's ranges only take table room (a full table is a flush).
  (func $uop_drop_ranges (param $pc i32)
    (local $i i32) (local $e i32) (local $last i32)
    (block $d (loop $l
      (br_if $d (i32.ge_u (local.get $i) (global.get $uop_nranges)))
      (local.set $e (i32.add (i32.add (global.get $uop_arena) (global.get $uop_ranges_off))
                             (i32.mul (local.get $i) (i32.const 12))))
      (if (i32.eq (i32.load offset=8 (local.get $e)) (local.get $pc))
        (then
          (global.set $uop_nranges (i32.sub (global.get $uop_nranges) (i32.const 1)))
          (local.set $last (i32.add (i32.add (global.get $uop_arena) (global.get $uop_ranges_off))
                                    (i32.mul (global.get $uop_nranges) (i32.const 12))))
          (i32.store (local.get $e) (i32.load (local.get $last)))
          (i32.store offset=4 (local.get $e) (i32.load offset=4 (local.get $last)))
          (i32.store offset=8 (local.get $e) (i32.load offset=8 (local.get $last)))
          (br $l)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l))))

  ;; Throw every program away: the arena is full, or the decoded code
  ;; everything was lowered from can no longer be trusted.
  (func $uop_flush
    (global.set $uop_gen (i32.add (global.get $uop_gen) (i32.const 1)))
    (if (i32.eqz (global.get $uop_gen)) (then (global.set $uop_gen (i32.const 1))))
    (global.set $uop_nranges (i32.const 0))
    (global.set $uop_alloc (i32.const 0)))
  ;; ... and when the code itself may have changed, the verdicts on it too:
  ;; forget every retired and declined marker ($uop_mark_dead).
  (func $uop_flush_all
    (call $uop_flush)
    (memory.fill (i32.add (global.get $uop_arena) (global.get $uop_map_off))
                 (i32.const 0) (i32.const 0x8000)))
  ;; Point this instance at its arena and start it empty. A worker's arena is
  ;; carved out of memory that held another thread's threaded code, so the map
  ;; is garbage until this clears it.
  (func $uop_set_arena (param $base i32) (param $size i32)
    (global.set $uop_arena (local.get $base))
    (global.set $uop_code_bytes (i32.sub (local.get $size) (global.get $UOP_TAIL)))
    (global.set $uop_temps_off (global.get $uop_code_bytes))
    (global.set $uop_wins_off (i32.add (global.get $uop_code_bytes) (i32.const 0x4000)))
    (global.set $uop_map_off (i32.add (global.get $uop_code_bytes) (i32.const 0x8000)))
    (global.set $uop_ranges_off (i32.add (global.get $uop_code_bytes) (i32.const 0x10000)))
    (call $uop_flush_all))

  ;; The enter op, first in the head block's threaded code. Its operand is
  ;; the program header. Anything it cannot vouch for falls through into the
  ;; threaded block, which is the same code: the enter op is never needed for
  ;; correctness.
  (func $th_uop_enter (param $op i32)
    (local $nx_fn i32) (local $nx_op i32)
    (local $w i32) (local $n i32) (local $b0 i32) (local $b1 i32)
    (if (i32.and
          (i32.and (i32.eq (i32.load (local.get $op)) (global.get $uop_gen))
                   (i32.eq (i32.load offset=4 (local.get $op)) (global.get $eip)))
          (i32.eqz (i32.or (global.get $dbg_chain_guard) (global.get $code16))))
      (then
        ;; Poison every window: an address no guest touches, aimed at the
        ;; same sentinel $g2w answers for unmapped memory, so the first access
        ;; through each misses and guards its own page.
        (local.set $n (i32.load offset=8 (local.get $op)))
        (local.set $w (i32.load offset=12 (local.get $op)))
        (block $d (loop $l
          (br_if $d (i32.eqz (local.get $n)))
          (i32.store (local.get $w) (i32.const 0xFFFFFFF0))
          (i32.store offset=4 (local.get $w) (i32.const 4))
          (i32.store offset=8 (local.get $w)
            (i32.sub (global.get $NULL_SENTINEL) (i32.const 0xFFFFFFF0)))
          (i32.store offset=12 (local.get $w) (i32.const 0))
          (local.set $w (i32.add (local.get $w) (i32.const 16)))
          (local.set $n (i32.sub (local.get $n) (i32.const 1)))
          (br $l)))
        (local.set $b0 (global.get $block_budget))
        (local.set $b1 (call $uop_run (i32.add (local.get $op) (global.get $UOP_HDR))
                                      (local.get $b0)))
        (global.set $block_budget (local.get $b1))
        (global.set $uop_enters (i32.add (global.get $uop_enters) (i32.const 1)))
        (global.set $uop_blocks (i64.add (global.get $uop_blocks)
          (i64.extend_i32_s (i32.sub (local.get $b0) (local.get $b1)))))
        (i32.store offset=16 (local.get $op)
          (i32.add (i32.load offset=16 (local.get $op)) (i32.const 1)))
        (i32.store offset=20 (local.get $op)
          (i32.add (i32.load offset=20 (local.get $op)) (i32.sub (local.get $b0) (local.get $b1))))
        ;; EXITB: the batch is over, at the transfer target, as in threaded.
        (if (global.get $uop_bexit)
          (then
            (global.set $uop_bexit (i32.const 0))
            (global.set $block_budget (i32.const 0))
            (return)))
        ;; Resume in threaded code through $branch_end, adding back the block
        ;; it charges: an exit is not a transfer of its own. (An exit to the
        ;; head falls straight into the threaded head block instead, since
        ;; $branch_end would re-enter the program.)
        (if (i32.or (i32.ne (global.get $eip) (i32.load offset=4 (local.get $op)))
                    (i32.lt_s (local.get $b1) (i32.const 0)))
          (then
            (global.set $block_budget (i32.add (local.get $b1) (i32.const 1)))
            ;; Retire a program that is entered often and does almost
            ;; nothing per entry: the enter/exit is then pure overhead.
            (if (i32.and (i32.ge_u (i32.load offset=16 (local.get $op)) (i32.const 256))
                         (i32.lt_u (i32.load offset=20 (local.get $op))
                                   (i32.shl (i32.load offset=16 (local.get $op)) (i32.const 1))))
              (then
                (global.set $uop_retired_poor (i32.add (global.get $uop_retired_poor) (i32.const 1)))
                (call $uop_retire_poor (local.get $op))))
            (return_call $branch_end)))
        (global.set $uop_head_exits (i32.add (global.get $uop_head_exits) (i32.const 1)))
        (i32.store offset=24 (local.get $op)
          (i32.add (i32.load offset=24 (local.get $op)) (i32.const 1)))))
    (dispatch-next))

  (func $uop_arena_addr (export "uop_arena") (result i32) (global.get $uop_arena))
  (func (export "uop_reg_base") (result i32) (global.get $reg_base))
  (func (export "uop_run") (param $pc i32) (param $budget i32) (result i32)
    (call $uop_run (local.get $pc) (local.get $budget)))
  ;; CF | ZF<<1 | SF<<2 | OF<<3 | PF<<4, so a test can compare two arms'
  ;; flags whatever lazy representation each left behind.
  (func (export "uop_flags") (result i32)
    (i32.or
      (i32.or (i32.or (call $get_cf) (i32.shl (call $get_zf) (i32.const 1)))
              (i32.or (i32.shl (call $get_sf) (i32.const 2)) (i32.shl (call $get_of) (i32.const 3))))
      (i32.shl (call $get_pf) (i32.const 4))))
  (func (export "uop_stats") (param $which i32) (result i32)
    (if (i32.eq (local.get $which) (i32.const 0)) (then (return (global.get $uop_guard_fails))))
    (if (i32.eq (local.get $which) (i32.const 1)) (then (return (global.get $uop_reguards))))
    (if (i32.eq (local.get $which) (i32.const 2)) (then (return (global.get $uop_installs))))
    (if (i32.eq (local.get $which) (i32.const 3)) (then (return (global.get $uop_kills))))
    (if (i32.eq (local.get $which) (i32.const 4)) (then (return (global.get $uop_enters))))
    (if (i32.eq (local.get $which) (i32.const 5)) (then (return (i32.wrap_i64 (global.get $uop_blocks)))))
    (if (i32.eq (local.get $which) (i32.const 6)) (then (return (global.get $uop_head_exits))))
    (if (i32.eq (local.get $which) (i32.const 7)) (then (return (global.get $uop_retired_poor))))
    (if (i32.eq (local.get $which) (i32.const 8)) (then (return (global.get $uop_gen))))
    (i32.const 0))
  ;; Where the lowering may write: 0 code base, 1 code bytes, 2 temps base,
  ;; 3 windows base.
  (func (export "uop_layout") (param $which i32) (result i32)
    (if (i32.eq (local.get $which) (i32.const 0)) (then (return (global.get $uop_arena))))
    (if (i32.eq (local.get $which) (i32.const 1)) (then (return (global.get $uop_code_bytes))))
    (if (i32.eq (local.get $which) (i32.const 2))
      (then (return (i32.add (global.get $uop_arena) (global.get $uop_temps_off)))))
    (if (i32.eq (local.get $which) (i32.const 3))
      (then (return (i32.add (global.get $uop_arena) (global.get $uop_wins_off)))))
    (i32.const 0))
  ;; Off also retires every installed program: bumping the generation makes
  ;; each enter op already in threaded code fall straight through, so the
  ;; switch takes effect mid-run without a cache flush.
  (func (export "set_uop") (param $on i32)
    (global.set $uop_enabled (i32.ne (local.get $on) (i32.const 0)))
    (if (i32.eqz (global.get $uop_enabled)) (then (call $uop_flush)))
    (call $bx_hot_gate_refresh))
  (func (export "get_uop") (result i32) (global.get $uop_enabled))
  (func (export "uop_add_range") (param $lo i32) (param $hi i32) (param $pc i32) (result i32)
    (call $uop_add_range (local.get $lo) (local.get $hi) (local.get $pc)))
  (func (export "uop_flush") (call $uop_flush))
  (func (export "uop_gen") (result i32) (global.get $uop_gen))
  ;; Test hook: install a hand-built program for $eip without the hotness
  ;; gate, exactly as $uop_try would.
  (func (export "uop_install") (param $eip i32) (param $pc i32)
    (call $uop_install (local.get $eip) (local.get $pc)))
