  ;; ============================================================
  ;; REGISTER ACCESS
  ;; ============================================================
  ;; br_table, not a chain of seven compares. These two are called several times
  ;; per memory-form instruction — a single `cmp [ebp+8], esi` used to walk this
  ;; chain three times — so the average three data-dependent branches per call
  ;; were a real share of the interpreter's work. A br_table is one indexed
  ;; jump. The default arm covers r=7 and anything out of range, exactly as the
  ;; fall-through did.
  (func $get_reg (param $r i32) (result i32)
    (block $edi (block $esi (block $ebp (block $esp
      (block $ebx (block $edx (block $ecx (block $eax
        (br_table $eax $ecx $edx $ebx $esp $ebp $esi $edi (local.get $r)))
        (return (global.get $eax)))
        (return (global.get $ecx)))
        (return (global.get $edx)))
        (return (global.get $ebx)))
        (return (global.get $esp)))
        (return (global.get $ebp)))
        (return (global.get $esi)))
    (global.get $edi)
  )

  (func $set_reg (param $r i32) (param $v i32)
    (block $edi (block $esi (block $ebp (block $esp
      (block $ebx (block $edx (block $ecx (block $eax
        (br_table $eax $ecx $edx $ebx $esp $ebp $esi $edi (local.get $r)))
        (global.set $eax (local.get $v)) (return))
        (global.set $ecx (local.get $v)) (return))
        (global.set $edx (local.get $v)) (return))
        (global.set $ebx (local.get $v)) (return))
        (global.set $esp (local.get $v)) (return))
        (global.set $ebp (local.get $v)) (return))
        (global.set $esi (local.get $v)) (return))
    (global.set $edi (local.get $v))
  )

  ;; Get byte register value (0-3=al/cl/dl/bl, 4-7=ah/ch/dh/bh)
  (func $get_reg8 (param $r i32) (result i32)
    (if (result i32) (i32.lt_u (local.get $r) (i32.const 4))
      (then (i32.and (call $get_reg (local.get $r)) (i32.const 0xFF)))
      (else (i32.and (i32.shr_u (call $get_reg (i32.sub (local.get $r) (i32.const 4))) (i32.const 8)) (i32.const 0xFF))))
  )

  ;; Set byte register (preserves other bits)
  (func $set_reg8 (param $r i32) (param $v i32)
    (local $old i32)
    (if (i32.lt_u (local.get $r) (i32.const 4))
      (then
        (local.set $old (call $get_reg (local.get $r)))
        (call $set_reg (local.get $r) (i32.or (i32.and (local.get $old) (i32.const 0xFFFFFF00)) (i32.and (local.get $v) (i32.const 0xFF)))))
      (else
        (local.set $old (call $get_reg (i32.sub (local.get $r) (i32.const 4))))
        (call $set_reg (i32.sub (local.get $r) (i32.const 4))
          (i32.or (i32.and (local.get $old) (i32.const 0xFFFF00FF))
            (i32.shl (i32.and (local.get $v) (i32.const 0xFF)) (i32.const 8))))))
  )

  ;; Get/set 16-bit register
  (func $get_reg16 (param $r i32) (result i32)
    (i32.and (call $get_reg (local.get $r)) (i32.const 0xFFFF))
  )
  (func $set_reg16 (param $r i32) (param $v i32)
    (call $set_reg (local.get $r)
      (i32.or (i32.and (call $get_reg (local.get $r)) (i32.const 0xFFFF0000))
              (i32.and (local.get $v) (i32.const 0xFFFF))))
  )

  ;; ============================================================
  ;; GUEST MEMORY
  ;; ============================================================
  ;; Null sentinel: a 4-byte region at offset 0xF0 that stays zeroed.
  ;; Used as g2w fallback so reads from invalid guest addresses see zeros
  ;; (simulating Windows null-page behavior) and writes go to a harmless sink.
  (global $NULL_SENTINEL i32 (i32.const 0xF0))
  (func $g2w (param $ga i32) (result i32)
    (local $wa i32) (local $i i32) (local $count i32) (local $off i32)
    (local $rec i32) (local $base i32) (local $size i32) (local $backing i32)
    (local.set $wa (i32.add (i32.sub (local.get $ga) (global.get $image_base)) (global.get $GUEST_BASE)))
    (if (i32.eqz (i32.or (i32.lt_s (local.get $wa) (i32.const 0))
                (i32.ge_u (local.get $wa) (region.end $DIRECT_WINDOW))))
      (then (return (local.get $wa))))
    ;; CreateDIBSection pointers live in a dedicated high guest range backed by
    ;; the final 64MB of linear memory. Test it only after the normal direct
    ;; window misses so ordinary loads retain their original hot path.
    (if (i32.lt_u
          (i32.sub (local.get $ga) (global.get $DIB_GUEST_BASE))
          (global.get $DIB_GUEST_CAPACITY))
      (then
        (return (i32.add
          (global.get $DIB_BACKING_BASE)
          (i32.sub (local.get $ga) (global.get $DIB_GUEST_BASE))))))
    ;; Sparse VirtualAlloc mappings live outside the direct image-relative
    ;; window. Map records are append-only (VirtualFree currently preserves
    ;; its backing), so a successful last-range translation remains valid even
    ;; when another thread appends or extends a record. An extension can miss
    ;; the old cached size once, then the scan below refreshes it.
    (local.set $off
      (i32.sub (local.get $ga) (global.get $g2w_sparse_base)))
    (if (i32.lt_u (local.get $off) (global.get $g2w_sparse_size))
      (then
        (return (i32.add (global.get $g2w_sparse_backing) (local.get $off)))))
    (local.set $off
      (i32.sub (local.get $ga) (global.get $g2w_sparse_base1)))
    (if (i32.lt_u (local.get $off) (global.get $g2w_sparse_size1))
      (then
        (return (i32.add (global.get $g2w_sparse_backing1) (local.get $off)))))
    (local.set $off
      (i32.sub (local.get $ga) (global.get $g2w_sparse_base2)))
    (if (i32.lt_u (local.get $off) (global.get $g2w_sparse_size2))
      (then
        (return (i32.add (global.get $g2w_sparse_backing2) (local.get $off)))))
    (local.set $off
      (i32.sub (local.get $ga) (global.get $g2w_sparse_base3)))
    (if (i32.lt_u (local.get $off) (global.get $g2w_sparse_size3))
      (then
        (return (i32.add (global.get $g2w_sparse_backing3) (local.get $off)))))
    ;; Scan only after direct, DIB, and cached sparse translation failed.
    ;; The count and each record's size are the two fields $virtual_map_commit
    ;; publishes LAST, after the memory they describe is mapped and zeroed. Read
    ;; them atomically so this scan cannot be reordered ahead of the record it is
    ;; about to trust. Everything else here is read-only, so no lock: the writer
    ;; holds $LOCK_VIRTUAL_MAP, the readers never do — see $virtual_map_commit.
    (local.set $count (i32.atomic.load (global.get $VIRTUAL_MAP_STATE)))
    (local.set $i (i32.const 0))
    (block $mapped_done (loop $mapped_scan
      (br_if $mapped_done (i32.ge_u (local.get $i) (local.get $count)))
      (local.set $rec (i32.add (global.get $VIRTUAL_MAP_TABLE) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $base (i32.load (local.get $rec)))
      (local.set $size (i32.atomic.load (i32.add (local.get $rec) (i32.const 4))))
      (if (i32.and
            (i32.ge_u (local.get $ga) (local.get $base))
            (i32.lt_u (local.get $ga) (i32.add (local.get $base) (local.get $size))))
        (then
          (local.set $backing (i32.load (i32.add (local.get $rec) (i32.const 8))))
          (global.set $g2w_sparse_base3 (global.get $g2w_sparse_base2))
          (global.set $g2w_sparse_size3 (global.get $g2w_sparse_size2))
          (global.set $g2w_sparse_backing3 (global.get $g2w_sparse_backing2))
          (global.set $g2w_sparse_base2 (global.get $g2w_sparse_base1))
          (global.set $g2w_sparse_size2 (global.get $g2w_sparse_size1))
          (global.set $g2w_sparse_backing2 (global.get $g2w_sparse_backing1))
          (global.set $g2w_sparse_base1 (global.get $g2w_sparse_base))
          (global.set $g2w_sparse_size1 (global.get $g2w_sparse_size))
          (global.set $g2w_sparse_backing1 (global.get $g2w_sparse_backing))
          (global.set $g2w_sparse_base (local.get $base))
          (global.set $g2w_sparse_size (local.get $size))
          (global.set $g2w_sparse_backing (local.get $backing))
          (return (i32.add (local.get $backing) (i32.sub (local.get $ga) (local.get $base))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $mapped_scan)))
    ;; Nothing maps this address. Report it if --fault-null asked us to; the
    ;; check is here, past every translation attempt, so an armed flag costs
    ;; the normal path nothing.
    (if (global.get $fault_unmapped)
      (then
        (call $host_unmapped_trace (local.get $ga) (global.get $eip))
        (if (i32.eq (global.get $fault_unmapped) (i32.const 2))
          (then (unreachable)))))
    ;; Re-zero the sentinel (in case a prior bad write landed here).
    (i32.store (global.get $NULL_SENTINEL) (i32.const 0))
    (global.get $NULL_SENTINEL)
  )

  ;; Translate a complete guest span only when one affine mapping contains it.
  ;; Unlike translating two endpoints, this proves that every byte between them
  ;; uses the same guest->WASM delta. Return NULL_SENTINEL when the span crosses
  ;; a mapping boundary or is unmapped, so callers can retain their elementwise
  ;; fallback. The unsigned `len <= size-off` form also rejects wrapped ends.
  (func $g2w_affine_span (param $ga i32) (param $len i32) (result i32)
    (local $wa i32) (local $off i32) (local $i i32) (local $count i32)
    (local $rec i32) (local $base i32) (local $size i32) (local $backing i32)

    (local.set $wa
      (i32.add (i32.sub (local.get $ga) (global.get $image_base))
        (global.get $GUEST_BASE)))
    (if (i32.and
          (i32.lt_u (local.get $wa) (region.end $DIRECT_WINDOW))
          (i32.le_u (local.get $len)
            (i32.sub (region.end $DIRECT_WINDOW) (local.get $wa))))
      (then (return (local.get $wa))))

    (local.set $off
      (i32.sub (local.get $ga) (global.get $DIB_GUEST_BASE)))
    (if (i32.and
          (i32.lt_u (local.get $off) (global.get $DIB_GUEST_CAPACITY))
          (i32.le_u (local.get $len)
            (i32.sub (global.get $DIB_GUEST_CAPACITY) (local.get $off))))
      (then
        (return (i32.add (global.get $DIB_BACKING_BASE) (local.get $off)))))

    ;; Check the four per-instance sparse records before scanning the shared
    ;; append-only table. A cached size is published atomically by g2w's scan.
    (local.set $off (i32.sub (local.get $ga) (global.get $g2w_sparse_base)))
    (if (i32.and
          (i32.lt_u (local.get $off) (global.get $g2w_sparse_size))
          (i32.le_u (local.get $len)
            (i32.sub (global.get $g2w_sparse_size) (local.get $off))))
      (then
        (return (i32.add (global.get $g2w_sparse_backing) (local.get $off)))))
    (local.set $off (i32.sub (local.get $ga) (global.get $g2w_sparse_base1)))
    (if (i32.and
          (i32.lt_u (local.get $off) (global.get $g2w_sparse_size1))
          (i32.le_u (local.get $len)
            (i32.sub (global.get $g2w_sparse_size1) (local.get $off))))
      (then
        (return (i32.add (global.get $g2w_sparse_backing1) (local.get $off)))))
    (local.set $off (i32.sub (local.get $ga) (global.get $g2w_sparse_base2)))
    (if (i32.and
          (i32.lt_u (local.get $off) (global.get $g2w_sparse_size2))
          (i32.le_u (local.get $len)
            (i32.sub (global.get $g2w_sparse_size2) (local.get $off))))
      (then
        (return (i32.add (global.get $g2w_sparse_backing2) (local.get $off)))))
    (local.set $off (i32.sub (local.get $ga) (global.get $g2w_sparse_base3)))
    (if (i32.and
          (i32.lt_u (local.get $off) (global.get $g2w_sparse_size3))
          (i32.le_u (local.get $len)
            (i32.sub (global.get $g2w_sparse_size3) (local.get $off))))
      (then
        (return (i32.add (global.get $g2w_sparse_backing3) (local.get $off)))))

    (local.set $count (i32.atomic.load (global.get $VIRTUAL_MAP_STATE)))
    (local.set $i (i32.const 0))
    (block $mapped_done (loop $mapped_scan
      (br_if $mapped_done (i32.ge_u (local.get $i) (local.get $count)))
      (local.set $rec
        (i32.add (global.get $VIRTUAL_MAP_TABLE)
          (i32.shl (local.get $i) (i32.const 4))))
      (local.set $base (i32.load (local.get $rec)))
      (local.set $size
        (i32.atomic.load (i32.add (local.get $rec) (i32.const 4))))
      (local.set $off (i32.sub (local.get $ga) (local.get $base)))
      (if (i32.and
            (i32.lt_u (local.get $off) (local.get $size))
            (i32.le_u (local.get $len)
              (i32.sub (local.get $size) (local.get $off))))
        (then
          (local.set $backing
            (i32.load (i32.add (local.get $rec) (i32.const 8))))
          ;; Populate the ordinary g2w cache too: a later scalar access to the
          ;; same record should benefit from this scan rather than repeat it.
          (global.set $g2w_sparse_base3 (global.get $g2w_sparse_base2))
          (global.set $g2w_sparse_size3 (global.get $g2w_sparse_size2))
          (global.set $g2w_sparse_backing3 (global.get $g2w_sparse_backing2))
          (global.set $g2w_sparse_base2 (global.get $g2w_sparse_base1))
          (global.set $g2w_sparse_size2 (global.get $g2w_sparse_size1))
          (global.set $g2w_sparse_backing2 (global.get $g2w_sparse_backing1))
          (global.set $g2w_sparse_base1 (global.get $g2w_sparse_base))
          (global.set $g2w_sparse_size1 (global.get $g2w_sparse_size))
          (global.set $g2w_sparse_backing1 (global.get $g2w_sparse_backing))
          (global.set $g2w_sparse_base (local.get $base))
          (global.set $g2w_sparse_size (local.get $size))
          (global.set $g2w_sparse_backing (local.get $backing))
          (return (i32.add (local.get $backing) (local.get $off)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $mapped_scan)))
    (global.get $NULL_SENTINEL)
  )
  (func $w2g (param $wa i32) (result i32)
    (if (result i32)
      (i32.lt_u
        (i32.sub (local.get $wa) (global.get $DIB_BACKING_BASE))
        (global.get $DIB_BACKING_BASE_SIZE))
      (then
        (i32.add
          (global.get $DIB_GUEST_BASE)
          (i32.sub (local.get $wa) (global.get $DIB_BACKING_BASE))))
      (else
        (i32.add
          (i32.sub (local.get $wa) (global.get $GUEST_BASE))
          (global.get $image_base)))))
  ;; Sparse VirtualAlloc ranges are guest-contiguous, but adjacent guest pages
  ;; need not have adjacent WASM backing (commits can be interleaved). Keep the
  ;; normal aligned/page-local path to one translation; only gather/scatter the
  ;; few x86 word/dword accesses that actually cross a non-contiguous boundary.
  (func $gl32 (param $ga i32) (result i32)
    (local $wa i32) (local $end_wa i32)
    (local.set $wa (call $g2w (local.get $ga)))
    (if (i32.le_u (i32.and (local.get $ga) (i32.const 0xFFF)) (i32.const 0xFFC))
      (then (return (i32.load (local.get $wa)))))
    (local.set $end_wa (call $g2w (i32.add (local.get $ga) (i32.const 3))))
    (if (i32.eq (local.get $end_wa) (i32.add (local.get $wa) (i32.const 3)))
      (then (return (i32.load (local.get $wa)))))
    (i32.or
      (i32.or
        (i32.load8_u (local.get $wa))
        (i32.shl
          (i32.load8_u (call $g2w (i32.add (local.get $ga) (i32.const 1))))
          (i32.const 8)))
      (i32.or
        (i32.shl
          (i32.load8_u (call $g2w (i32.add (local.get $ga) (i32.const 2))))
          (i32.const 16))
        (i32.shl
          (i32.load8_u (local.get $end_wa))
          (i32.const 24)))))
  (func $gl16 (param $ga i32) (result i32)
    (local $wa i32) (local $end_wa i32)
    (local.set $wa (call $g2w (local.get $ga)))
    (if (i32.ne (i32.and (local.get $ga) (i32.const 0xFFF)) (i32.const 0xFFF))
      (then (return (i32.load16_u (local.get $wa)))))
    (local.set $end_wa (call $g2w (i32.add (local.get $ga) (i32.const 1))))
    (if (i32.eq (local.get $end_wa) (i32.add (local.get $wa) (i32.const 1)))
      (then (return (i32.load16_u (local.get $wa)))))
    (i32.or
      (i32.load8_u (local.get $wa))
      (i32.shl (i32.load8_u (local.get $end_wa)) (i32.const 8))))
  (func $gl8 (param $ga i32) (result i32)
    (local $page i32) (local $wa i32)
    (local.set $page (i32.and (local.get $ga) (i32.const 0xFFFFF000)))
    (if (i32.eq (local.get $page) (global.get $g2w_gl8_page))
      (then
        (return (i32.load8_u
          (i32.add (local.get $ga) (global.get $g2w_gl8_delta))))))
    (local.set $wa (call $g2w (local.get $ga)))
    ;; Never cache an invalid translation: NULL_SENTINEL is four bytes, not a
    ;; backing page, and adding an address offset to it would turn later bad
    ;; reads into arbitrary linear-memory reads.
    (if (i32.ne (local.get $wa) (global.get $NULL_SENTINEL))
      (then
        (global.set $g2w_gl8_page (local.get $page))
        (global.set $g2w_gl8_delta (i32.sub (local.get $wa) (local.get $ga)))))
    (i32.load8_u (local.get $wa)))
  ;; Cheap "could a write here be touching code?" test, for one guest address.
  ;; Split out of $invalidate_code_write so the range form can skip it when the
  ;; write spans pages and the per-page walk will ask the question anyway.
  (func $code_write_is_code (param $ga i32) (result i32)
    (local $in_sparse_generated i32)
    (local.set $in_sparse_generated
      (i32.and
        (i32.ne (global.get $generated_sparse_code_start) (i32.const 0))
        (i32.and (i32.ge_u (local.get $ga) (global.get $generated_sparse_code_start))
                 (i32.lt_u (local.get $ga) (global.get $generated_sparse_code_end)))))
    (i32.or
      (local.get $in_sparse_generated)
      (call $code_page_test (local.get $ga))))

  ;; A write of $len bytes starting at $ga. The length is not decoration: with
  ;; per-offset invalidation (docs/page-compile-design.md section 5) the retire
  ;; walk needs the real extent, because it retires the blocks that cover the
  ;; bytes named and nothing else. Passing only the first and last byte of a
  ;; REP MOVS -- which is what the page-granularity design got away with, since
  ;; two endpoints named every page in between as long as there were at most
  ;; two -- would now leave every block in the middle live over rewritten bytes.
  (func $invalidate_code_write (param $ga i32) (param $len i32)
    ;; Invalidate decoded blocks only when writes can affect already-decoded
    ;; executable bytes. RCT mutates large image-data buffers during startup;
    ;; treating every image write as self-modifying code makes each byte/word
    ;; update scan the whole block-cache index.
    ;;
    ;; $code_page_test answers that exactly for every guest page below
    ;; $VIRTUAL_ALLOC_MIN: its bit is set by $cache_store, so it is on iff a
    ;; block was decoded out of that page. It replaces the old code_start..end
    ;; and generated_code_start..end span tests, which were both coarser (a
    ;; span covers every data page between its ends — RCT executes and writes
    ;; inside one CodeSeg section) and blind to code generated into ordinary
    ;; heap memory, which lies in neither span. Storm's runtime blitters are
    ;; exactly that case.
    (if (i32.eqz (global.get $exe_size_of_image)) (then (return)))
    ;; The hot case is a 1/2/4-byte write inside one page: answer it with the
    ;; bitmap and decline without a call. A write that spans pages goes straight
    ;; to the range walk, which tests each page's directory slot itself -- a
    ;; first-page test would be wrong there, since the code could be in the last
    ;; page of the span.
    (if (i32.le_u (i32.add (i32.and (local.get $ga) (i32.const 0xFFF)) (local.get $len))
                  (i32.const 4096))
      (then
        (if (i32.eqz (call $code_write_is_code (local.get $ga))) (then (return)))))
    ;; Multi-page spans need every page in between retired, not just the two
    ;; ends -- main fixed that with its own $invalidate_code_range, and the
    ;; page-compile one below already walks page by page, so that fix arrives
    ;; here as a property of the range walk rather than a second function.
    (call $invalidate_code_range (local.get $ga) (local.get $len)))
  (func $gs32 (param $ga i32) (param $v i32)
    (local $wa i32) (local $end_wa i32)
    (local.set $wa (call $g2w (local.get $ga)))
    (call $invalidate_code_write (local.get $ga) (i32.const 4))
    (if (i32.le_u (i32.and (local.get $ga) (i32.const 0xFFF)) (i32.const 0xFFC))
      (then (i32.store (local.get $wa) (local.get $v)) (return)))
    (local.set $end_wa (call $g2w (i32.add (local.get $ga) (i32.const 3))))
    (if (i32.eq (local.get $end_wa) (i32.add (local.get $wa) (i32.const 3)))
      (then (i32.store (local.get $wa) (local.get $v)) (return)))
    (i32.store8 (local.get $wa) (local.get $v))
    (i32.store8
      (call $g2w (i32.add (local.get $ga) (i32.const 1)))
      (i32.shr_u (local.get $v) (i32.const 8)))
    (i32.store8
      (call $g2w (i32.add (local.get $ga) (i32.const 2)))
      (i32.shr_u (local.get $v) (i32.const 16)))
    (i32.store8 (local.get $end_wa) (i32.shr_u (local.get $v) (i32.const 24))))
  (func $gs16 (param $ga i32) (param $v i32)
    (local $wa i32) (local $end_wa i32)
    (local.set $wa (call $g2w (local.get $ga)))
    (call $invalidate_code_write (local.get $ga) (i32.const 2))
    (if (i32.ne (i32.and (local.get $ga) (i32.const 0xFFF)) (i32.const 0xFFF))
      (then (i32.store16 (local.get $wa) (local.get $v)) (return)))
    (local.set $end_wa (call $g2w (i32.add (local.get $ga) (i32.const 1))))
    (if (i32.eq (local.get $end_wa) (i32.add (local.get $wa) (i32.const 1)))
      (then (i32.store16 (local.get $wa) (local.get $v)) (return)))
    (i32.store8 (local.get $wa) (local.get $v))
    (i32.store8 (local.get $end_wa) (i32.shr_u (local.get $v) (i32.const 8))))
  (func $gs8 (param $ga i32) (param $v i32)
    (local $wa i32)
    (local.set $wa (call $g2w (local.get $ga)))
    (call $invalidate_code_write (local.get $ga) (i32.const 1))
    (i32.store8 (local.get $wa) (local.get $v)))

  ;; ============================================================
  ;; LAZY FLAGS
  ;; ============================================================
  (func $set_flags_add (param $a i32) (param $b i32) (param $r i32)
    (global.set $flag_op (i32.const 1)) (global.set $flag_sign_shift (i32.const 31))
    (global.set $flag_a (local.get $a)) (global.set $flag_b (local.get $b)) (global.set $flag_res (local.get $r)))
  (func $set_flags_sub (param $a i32) (param $b i32) (param $r i32)
    (global.set $flag_op (i32.const 2)) (global.set $flag_sign_shift (i32.const 31))
    (global.set $flag_a (local.get $a)) (global.set $flag_b (local.get $b)) (global.set $flag_res (local.get $r)))
  (func $set_flags_logic (param $r i32)
    (global.set $flag_op (i32.const 3)) (global.set $flag_sign_shift (i32.const 31)) (global.set $flag_res (local.get $r)))
  (func $set_flags_shift (param $r i32) (param $cf i32)
    (global.set $flag_op (i32.const 7)) (global.set $flag_sign_shift (i32.const 31)) (global.set $flag_res (local.get $r))
    (global.set $flag_b (local.get $cf)))
  (func $set_flags_inc (param $a i32) (param $r i32)
    (global.set $saved_cf (call $get_cf))  ;; INC preserves CF
    (global.set $flag_op (i32.const 4)) (global.set $flag_sign_shift (i32.const 31))
    (global.set $flag_a (local.get $a)) (global.set $flag_b (i32.const 1)) (global.set $flag_res (local.get $r)))
  (func $set_flags_dec (param $a i32) (param $r i32)
    (global.set $saved_cf (call $get_cf))  ;; DEC preserves CF
    (global.set $flag_op (i32.const 5)) (global.set $flag_sign_shift (i32.const 31))
    (global.set $flag_a (local.get $a)) (global.set $flag_b (i32.const 1)) (global.set $flag_res (local.get $r)))

  (func $get_zf (result i32) (i32.eqz (global.get $flag_res)))
  (func $get_sf (result i32) (i32.and (i32.shr_u (global.get $flag_res) (global.get $flag_sign_shift)) (i32.const 1)))
  (func $get_cf (result i32)
    (if (result i32) (i32.eq (global.get $flag_op) (i32.const 1))
      (then (i32.lt_u (global.get $flag_res) (global.get $flag_a)))
    (else (if (result i32) (i32.eq (global.get $flag_op) (i32.const 2))
      (then (i32.lt_u (global.get $flag_a) (global.get $flag_b)))
    (else (if (result i32) (i32.or (i32.eq (global.get $flag_op) (i32.const 4))
                                   (i32.eq (global.get $flag_op) (i32.const 5)))
      (then (global.get $saved_cf))  ;; INC/DEC preserve CF
    (else (if (result i32) (i32.eq (global.get $flag_op) (i32.const 6))
      (then (global.get $flag_b))  ;; MUL/IMUL: flag_b stores CF/OF
    (else (if (result i32) (i32.eq (global.get $flag_op) (i32.const 7))
      (then (global.get $flag_b))  ;; Shift: flag_b stores last bit shifted out
    (else (if (result i32) (i32.eq (global.get $flag_op) (i32.const 8))
      (then (global.get $flag_a))  ;; Raw mode: CF stored in flag_a
    (else (if (result i32) (i32.eq (global.get $flag_op) (i32.const 9))
      (then (i32.and (global.get $flag_a) (i32.const 1)))  ;; Exact raw: packed CF
    (else (i32.const 0))))))))))))))))
  (func $get_of (result i32)
    (local $sa i32) (local $sb i32) (local $sr i32)
    ;; Raw mode: OF stored in flag_b
    (if (i32.or (i32.eq (global.get $flag_op) (i32.const 8))
                 (i32.eq (global.get $flag_op) (i32.const 9)))
      (then (return (global.get $flag_b))))
    ;; MUL/IMUL: OF = CF = flag_b
    (if (i32.eq (global.get $flag_op) (i32.const 6))
      (then (return (global.get $flag_b))))
    (local.set $sa (i32.and (i32.shr_u (global.get $flag_a) (global.get $flag_sign_shift)) (i32.const 1)))
    (local.set $sb (i32.and (i32.shr_u (global.get $flag_b) (global.get $flag_sign_shift)) (i32.const 1)))
    (local.set $sr (i32.and (i32.shr_u (global.get $flag_res) (global.get $flag_sign_shift)) (i32.const 1)))
    (if (result i32) (i32.or (i32.eq (global.get $flag_op) (i32.const 1)) (i32.eq (global.get $flag_op) (i32.const 4)))
      (then (i32.and (i32.eq (local.get $sa) (local.get $sb)) (i32.ne (local.get $sa) (local.get $sr))))
    (else (if (result i32) (i32.or (i32.eq (global.get $flag_op) (i32.const 2)) (i32.eq (global.get $flag_op) (i32.const 5)))
      (then (i32.and (i32.ne (local.get $sa) (local.get $sb)) (i32.eq (local.get $sb) (local.get $sr))))
    (else (i32.const 0))))))

  ;; SAHF/POPF supply independently writable flags. In exact raw mode (9),
  ;; flag_a packs CF in bit 0 and PF in bit 1. Other modes derive parity from
  ;; the lazy arithmetic result as before.
  (func $get_pf (result i32)
    (if (result i32) (i32.eq (global.get $flag_op) (i32.const 9))
      (then (i32.and (i32.shr_u (global.get $flag_a) (i32.const 1)) (i32.const 1)))
      (else (i32.eqz (i32.and
        (i32.popcnt (i32.and (global.get $flag_res) (i32.const 0xFF)))
        (i32.const 1))))))

  ;; Evaluate condition code (same encoding as x86 Jcc lower nibble)
  ;; 0=O,1=NO,2=B,3=AE,4=Z,5=NZ,6=BE,7=A,8=S,9=NS,A=P,B=NP,C=L,D=GE,E=LE,F=G
  (func $eval_cc (param $cc i32) (result i32)
    (local $r i32)
    (if (i32.eq (local.get $cc) (i32.const 0x0)) (then (return (call $get_of))))
    (if (i32.eq (local.get $cc) (i32.const 0x1)) (then (return (i32.eqz (call $get_of)))))
    (if (i32.eq (local.get $cc) (i32.const 0x2)) (then (return (call $get_cf))))
    (if (i32.eq (local.get $cc) (i32.const 0x3)) (then (return (i32.eqz (call $get_cf)))))
    (if (i32.eq (local.get $cc) (i32.const 0x4)) (then (return (call $get_zf))))
    (if (i32.eq (local.get $cc) (i32.const 0x5)) (then (return (i32.eqz (call $get_zf)))))
    (if (i32.eq (local.get $cc) (i32.const 0x6)) (then (return (i32.or (call $get_cf) (call $get_zf)))))
    (if (i32.eq (local.get $cc) (i32.const 0x7)) (then (return (i32.and (i32.eqz (call $get_cf)) (i32.eqz (call $get_zf))))))
    (if (i32.eq (local.get $cc) (i32.const 0x8)) (then (return (call $get_sf))))
    (if (i32.eq (local.get $cc) (i32.const 0x9)) (then (return (i32.eqz (call $get_sf)))))
    ;; 0xA=P (parity even): low byte of result has even number of set bits
    (if (i32.eq (local.get $cc) (i32.const 0xA)) (then (return (call $get_pf))))
    ;; 0xB=NP (parity odd)
    (if (i32.eq (local.get $cc) (i32.const 0xB)) (then (return (i32.eqz (call $get_pf)))))
    ;; 0xC=L: SF!=OF
    (if (i32.eq (local.get $cc) (i32.const 0xC)) (then (return (i32.ne (call $get_sf) (call $get_of)))))
    ;; 0xD=GE: SF==OF
    (if (i32.eq (local.get $cc) (i32.const 0xD)) (then (return (i32.eq (call $get_sf) (call $get_of)))))
    ;; 0xE=LE: ZF=1 or SF!=OF
    (if (i32.eq (local.get $cc) (i32.const 0xE)) (then (return (i32.or (call $get_zf) (i32.ne (call $get_sf) (call $get_of))))))
    ;; 0xF=G: ZF=0 and SF==OF
    (i32.and (i32.eqz (call $get_zf)) (i32.eq (call $get_sf) (call $get_of)))
  )

  ;; Build EFLAGS from lazy state (for pushfd)
  ;;
  ;; PF comes from the same expression $eval_cc uses for JP/SETP, so a program
  ;; that reads parity out of a pushed EFLAGS word agrees with one that branches
  ;; on it. $eflags_extra carries every bit we do not model (IF, IOPL, NT, RF,
  ;; AC, and bit 21 ID) straight back out of the last popfd -- see $load_eflags.
  (func $build_eflags (result i32)
    (i32.or (i32.or (i32.or (i32.or
      (i32.shl (call $get_cf) (i32.const 0))
      (i32.const 2))  ;; bit 1 always set
      (i32.or
        (i32.shl (call $get_zf) (i32.const 6))
        (i32.shl (call $get_sf) (i32.const 7))))
      (i32.or
        (i32.shl (global.get $df) (i32.const 10))
        (i32.shl (call $get_of) (i32.const 11))))
      (i32.or
        (i32.shl (call $get_pf) (i32.const 2))  ;; PF
        (global.get $eflags_extra)))
  )

  ;; Restore flags from EFLAGS value (for popfd)
  ;; Uses flag_op=9 (exact raw mode): CF/PF/ZF/SF/OF are independent.
  (func $load_eflags (param $f i32)
    ;; Everything outside the six bits we model is remembered verbatim, so
    ;; pushfd hands it back. Dropping it used to break the standard CPUID probe
    ;; (toggle bit 21, pushfd, compare): the toggle never survived, so the ID
    ;; bit read back unchanged and the program concluded the CPU has no CPUID
    ;; at all. Allegro does exactly this, which is why Liquid War never even
    ;; executed the cpuid its binary contains, and so never installed its MMX
    ;; blitters. Mask = ~(CF|bit1|PF|AF|ZF|SF|DF|OF).
    (global.set $eflags_extra (i32.and (local.get $f) (i32.const 0xFFFFF328)))
    (global.set $df (i32.and (i32.shr_u (local.get $f) (i32.const 10)) (i32.const 1)))
    (global.set $flag_op (i32.const 9))  ;; exact raw flags mode
    ;; Pack CF/PF in flag_a, OF in flag_b, and encode ZF/SF in flag_res.
    (global.set $flag_a (i32.or
      (i32.and (local.get $f) (i32.const 1))
      (i32.and (i32.shr_u (local.get $f) (i32.const 1)) (i32.const 2))))
    (global.set $flag_b (i32.and (i32.shr_u (local.get $f) (i32.const 11)) (i32.const 1)))  ;; OF = bit 11
    ;; flag_res: bit 31 = SF, zero iff ZF. This makes get_zf and get_sf work with flag_sign_shift=31.
    ;;
    ;; PF is carried independently in flag_a, so even synthetic combinations
    ;; such as ZF=1/PF=0 round-trip exactly.
    (global.set $flag_sign_shift (i32.const 31))
    (if (i32.and (local.get $f) (i32.const 0x40))  ;; ZF = bit 6
      (then (global.set $flag_res (i32.const 0)))
      (else (if (i32.and (local.get $f) (i32.const 0x80))  ;; SF = bit 7
        (then (global.set $flag_res (i32.const 0x80000001)))
        (else (global.set $flag_res (i32.const 1))))))
  )

  ;; Exact owned context for an outer-boundary native guest detour.
  ;; frame is a contiguous WASM address; caller owns at least564 bytes.
  ;; Not architectural FNSAVE: raw integer shadows and NaN payloads survive.
  ;; Layout (i32 offsets; reserved228 is zeroed):
  ;; 0: eax
  ;; 4: ecx
  ;; 8: edx
  ;; 12: ebx
  ;; 16: esp
  ;; 20: ebp
  ;; 24: esi
  ;; 28: edi
  ;; 32: eip
  ;; 36: flag_op
  ;; 40: flag_a
  ;; 44: flag_b
  ;; 48: flag_res
  ;; 52: flag_sign_shift
  ;; 56: saved_cf
  ;; 60: df
  ;; 64: eflags_extra
  ;; 68: code16
  ;; 72: sreg_es
  ;; 76: sreg_cs
  ;; 80: sreg_ss
  ;; 84: sreg_ds
  ;; 88: seg_base_es
  ;; 92: seg_base_cs
  ;; 96: seg_base_ss
  ;; 100: seg_base_ds
  ;; 104: fs_base
  ;; 108: fpu_top
  ;; 112: fpu_cw
  ;; 116: fpu_sw
  ;; 120: fpu_tag
  ;; 124: fpu_raw_tag
  ;; 128: yield_flag
  ;; 132: yield_reason
  ;; 136: sleep_yielded
  ;; 140: sleep_timeout
  ;; 144: current_thunk_eip
  ;; 148: handler_set_eip
  ;; 152: message_wait_msg_ptr
  ;; 156: wait_handle
  ;; 160: wait_handles_ptr
  ;; 164: wait_all
  ;; 168: wait_timeout
  ;; 172: wait_stack_bytes
  ;; 176: cs_wait_addr
  ;; 180: cs_wait_owner
  ;; 184: cs_wait_spins
  ;; 188: cs_park_pending
  ;; 192: cs_resume_esp_delta
  ;; 196: vblank_wait_active
  ;; 200: vblank_wait_counter
  ;; 204: vblank_deadline_ms
  ;; 208: spin_deadline_ms
  ;; 212: clock_spin_parked_value
  ;; 216: clock_spin_parked_valid
  ;; 220: loadlib_name_ptr
  ;; 224: last_error
  ;;232:8 physical x87 f64 bitpatterns;296:8 raw i64;360:8 MMX i64;
  ;;424:8 XMM pairs (low/high i64). No shared clocks/events/cache pointers.
  ;;552: Delphi SEH registration;556: exception record;560: prior chain head.
  ;; These remain populated after nonlocal resume, so nonzero is not an
  ;; active-handler gate. Preserve them instead of blocking installed SEH.
  (global $GUEST_CONTEXT_SIZE i32 (i32.const 564))
  (func $guest_context_size (export "guest_context_size") (result i32)
    (global.get $GUEST_CONTEXT_SIZE))

  ;; Caller additionally excludes foreign host IO and saves JS scheduling
  ;; deadlines. Runnable, ordinary object-wait, and message-idle entry only.
  ;; No Wasm native frame may be suspended: invoke only after run() returns.
  (func $guest_context_can_interrupt (result i32)
    (local $job i32)
    (if (i32.eqz (global.get $eip)) (then (return (i32.const 0))))
    (if (global.get $resume_ip) (then (return (i32.const 0))))
    (if (global.get $sync_msg_depth) (then (return (i32.const 0))))
    (if (global.get $mm_timer_in_cb) (then (return (i32.const 0))))
    (if (global.get $cs_park_pending) (then (return (i32.const 0))))
    (if (global.get $modal_restore_pending) (then (return (i32.const 0))))
    (if (global.get $dlg_callback_yield_pending) (then (return (i32.const 0))))
    (if (global.get $sleep_yielded) (then (return (i32.const 0))))
    ;; Queued jobs may request this boundary; only executing guest callbacks
    ;; exclude interruption, including public32 calls without a separate stack.
    (local.set $job (global.get $help_macro_api_jobs))
    (block $done (loop $scan
      (br_if $done (i32.eqz (local.get $job)))
      (if (i32.eq (call $gl32 (i32.add (local.get $job) (i32.const 4))) (i32.const 2))
        (then (return (i32.const 0))))
      (local.set $job (call $gl32 (local.get $job)))
      (br $scan)))
    (i32.or (i32.eqz (global.get $yield_reason))
      (i32.or (i32.eq (global.get $yield_reason) (i32.const 1))
        (i32.eq (global.get $yield_reason) (i32.const 7)))))

  (func $guest_context_save (param $frame i32)
    (i32.store offset=0 (local.get $frame) (global.get $eax))
    (i32.store offset=4 (local.get $frame) (global.get $ecx))
    (i32.store offset=8 (local.get $frame) (global.get $edx))
    (i32.store offset=12 (local.get $frame) (global.get $ebx))
    (i32.store offset=16 (local.get $frame) (global.get $esp))
    (i32.store offset=20 (local.get $frame) (global.get $ebp))
    (i32.store offset=24 (local.get $frame) (global.get $esi))
    (i32.store offset=28 (local.get $frame) (global.get $edi))
    (i32.store offset=32 (local.get $frame) (global.get $eip))
    (i32.store offset=36 (local.get $frame) (global.get $flag_op))
    (i32.store offset=40 (local.get $frame) (global.get $flag_a))
    (i32.store offset=44 (local.get $frame) (global.get $flag_b))
    (i32.store offset=48 (local.get $frame) (global.get $flag_res))
    (i32.store offset=52 (local.get $frame) (global.get $flag_sign_shift))
    (i32.store offset=56 (local.get $frame) (global.get $saved_cf))
    (i32.store offset=60 (local.get $frame) (global.get $df))
    (i32.store offset=64 (local.get $frame) (global.get $eflags_extra))
    (i32.store offset=68 (local.get $frame) (global.get $code16))
    (i32.store offset=72 (local.get $frame) (global.get $sreg_es))
    (i32.store offset=76 (local.get $frame) (global.get $sreg_cs))
    (i32.store offset=80 (local.get $frame) (global.get $sreg_ss))
    (i32.store offset=84 (local.get $frame) (global.get $sreg_ds))
    (i32.store offset=88 (local.get $frame) (global.get $seg_base_es))
    (i32.store offset=92 (local.get $frame) (global.get $seg_base_cs))
    (i32.store offset=96 (local.get $frame) (global.get $seg_base_ss))
    (i32.store offset=100 (local.get $frame) (global.get $seg_base_ds))
    (i32.store offset=104 (local.get $frame) (global.get $fs_base))
    (i32.store offset=108 (local.get $frame) (global.get $fpu_top))
    (i32.store offset=112 (local.get $frame) (global.get $fpu_cw))
    (i32.store offset=116 (local.get $frame) (global.get $fpu_sw))
    (i32.store offset=120 (local.get $frame) (global.get $fpu_tag))
    (i32.store offset=124 (local.get $frame) (global.get $fpu_raw_tag))
    (i32.store offset=128 (local.get $frame) (global.get $yield_flag))
    (i32.store offset=132 (local.get $frame) (global.get $yield_reason))
    (i32.store offset=136 (local.get $frame) (global.get $sleep_yielded))
    (i32.store offset=140 (local.get $frame) (global.get $sleep_timeout))
    (i32.store offset=144 (local.get $frame) (global.get $current_thunk_eip))
    (i32.store offset=148 (local.get $frame) (global.get $handler_set_eip))
    (i32.store offset=152 (local.get $frame) (global.get $message_wait_msg_ptr))
    (i32.store offset=156 (local.get $frame) (global.get $wait_handle))
    (i32.store offset=160 (local.get $frame) (global.get $wait_handles_ptr))
    (i32.store offset=164 (local.get $frame) (global.get $wait_all))
    (i32.store offset=168 (local.get $frame) (global.get $wait_timeout))
    (i32.store offset=172 (local.get $frame) (global.get $wait_stack_bytes))
    (i32.store offset=176 (local.get $frame) (global.get $cs_wait_addr))
    (i32.store offset=180 (local.get $frame) (global.get $cs_wait_owner))
    (i32.store offset=184 (local.get $frame) (global.get $cs_wait_spins))
    (i32.store offset=188 (local.get $frame) (global.get $cs_park_pending))
    (i32.store offset=192 (local.get $frame) (global.get $cs_resume_esp_delta))
    (i32.store offset=196 (local.get $frame) (global.get $vblank_wait_active))
    (i32.store offset=200 (local.get $frame) (global.get $vblank_wait_counter))
    (i32.store offset=204 (local.get $frame) (global.get $vblank_deadline_ms))
    (i32.store offset=208 (local.get $frame) (global.get $spin_deadline_ms))
    (i32.store offset=212 (local.get $frame) (global.get $clock_spin_parked_value))
    (i32.store offset=216 (local.get $frame) (global.get $clock_spin_parked_valid))
    (i32.store offset=220 (local.get $frame) (global.get $loadlib_name_ptr))
    (i32.store offset=224 (local.get $frame) (global.get $last_error))
    (i32.store offset=228 (local.get $frame) (i32.const 0))
    (i64.store offset=232 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value0)))
    (i64.store offset=240 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value1)))
    (i64.store offset=248 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value2)))
    (i64.store offset=256 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value3)))
    (i64.store offset=264 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value4)))
    (i64.store offset=272 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value5)))
    (i64.store offset=280 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value6)))
    (i64.store offset=288 (local.get $frame) (i64.reinterpret_f64 (global.get $fpu_value7)))
    (i64.store offset=296 (local.get $frame) (global.get $fpu_raw0))
    (i64.store offset=304 (local.get $frame) (global.get $fpu_raw1))
    (i64.store offset=312 (local.get $frame) (global.get $fpu_raw2))
    (i64.store offset=320 (local.get $frame) (global.get $fpu_raw3))
    (i64.store offset=328 (local.get $frame) (global.get $fpu_raw4))
    (i64.store offset=336 (local.get $frame) (global.get $fpu_raw5))
    (i64.store offset=344 (local.get $frame) (global.get $fpu_raw6))
    (i64.store offset=352 (local.get $frame) (global.get $fpu_raw7))
    (i64.store offset=360 (local.get $frame) (global.get $mm0))
    (i64.store offset=368 (local.get $frame) (global.get $mm1))
    (i64.store offset=376 (local.get $frame) (global.get $mm2))
    (i64.store offset=384 (local.get $frame) (global.get $mm3))
    (i64.store offset=392 (local.get $frame) (global.get $mm4))
    (i64.store offset=400 (local.get $frame) (global.get $mm5))
    (i64.store offset=408 (local.get $frame) (global.get $mm6))
    (i64.store offset=416 (local.get $frame) (global.get $mm7))
    (i64.store offset=424 (local.get $frame) (global.get $xmm0l))
    (i64.store offset=432 (local.get $frame) (global.get $xmm0h))
    (i64.store offset=440 (local.get $frame) (global.get $xmm1l))
    (i64.store offset=448 (local.get $frame) (global.get $xmm1h))
    (i64.store offset=456 (local.get $frame) (global.get $xmm2l))
    (i64.store offset=464 (local.get $frame) (global.get $xmm2h))
    (i64.store offset=472 (local.get $frame) (global.get $xmm3l))
    (i64.store offset=480 (local.get $frame) (global.get $xmm3h))
    (i64.store offset=488 (local.get $frame) (global.get $xmm4l))
    (i64.store offset=496 (local.get $frame) (global.get $xmm4h))
    (i64.store offset=504 (local.get $frame) (global.get $xmm5l))
    (i64.store offset=512 (local.get $frame) (global.get $xmm5h))
    (i64.store offset=520 (local.get $frame) (global.get $xmm6l))
    (i64.store offset=528 (local.get $frame) (global.get $xmm6h))
    (i64.store offset=536 (local.get $frame) (global.get $xmm7l))
    (i64.store offset=544 (local.get $frame) (global.get $xmm7h))
    (i32.store offset=552 (local.get $frame) (global.get $delphi_seh_rec))
    (i32.store offset=556 (local.get $frame) (global.get $delphi_exception_record))
    (i32.store offset=560 (local.get $frame) (global.get $delphi_seh_head_before))
  )

  ;; Restore only at the outer host boundary, never in a slice tail. Decoded
  ;; stream pointers cannot survive a callback's cache invalidation. The next
  ;; run gets a fresh block budget/deadline; no shared event is rolled back.
  (func $guest_context_restore (param $frame i32)
    (global.set $eax (i32.load offset=0 (local.get $frame)))
    (global.set $ecx (i32.load offset=4 (local.get $frame)))
    (global.set $edx (i32.load offset=8 (local.get $frame)))
    (global.set $ebx (i32.load offset=12 (local.get $frame)))
    (global.set $esp (i32.load offset=16 (local.get $frame)))
    (global.set $ebp (i32.load offset=20 (local.get $frame)))
    (global.set $esi (i32.load offset=24 (local.get $frame)))
    (global.set $edi (i32.load offset=28 (local.get $frame)))
    (global.set $eip (i32.load offset=32 (local.get $frame)))
    (global.set $flag_op (i32.load offset=36 (local.get $frame)))
    (global.set $flag_a (i32.load offset=40 (local.get $frame)))
    (global.set $flag_b (i32.load offset=44 (local.get $frame)))
    (global.set $flag_res (i32.load offset=48 (local.get $frame)))
    (global.set $flag_sign_shift (i32.load offset=52 (local.get $frame)))
    (global.set $saved_cf (i32.load offset=56 (local.get $frame)))
    (global.set $df (i32.load offset=60 (local.get $frame)))
    (global.set $eflags_extra (i32.load offset=64 (local.get $frame)))
    (global.set $code16 (i32.load offset=68 (local.get $frame)))
    (global.set $sreg_es (i32.load offset=72 (local.get $frame)))
    (global.set $sreg_cs (i32.load offset=76 (local.get $frame)))
    (global.set $sreg_ss (i32.load offset=80 (local.get $frame)))
    (global.set $sreg_ds (i32.load offset=84 (local.get $frame)))
    (global.set $seg_base_es (i32.load offset=88 (local.get $frame)))
    (global.set $seg_base_cs (i32.load offset=92 (local.get $frame)))
    (global.set $seg_base_ss (i32.load offset=96 (local.get $frame)))
    (global.set $seg_base_ds (i32.load offset=100 (local.get $frame)))
    (global.set $fs_base (i32.load offset=104 (local.get $frame)))
    (global.set $fpu_top (i32.load offset=108 (local.get $frame)))
    (global.set $fpu_cw (i32.load offset=112 (local.get $frame)))
    (global.set $fpu_sw (i32.load offset=116 (local.get $frame)))
    (global.set $fpu_tag (i32.load offset=120 (local.get $frame)))
    (global.set $fpu_raw_tag (i32.load offset=124 (local.get $frame)))
    (global.set $yield_flag (i32.load offset=128 (local.get $frame)))
    (global.set $yield_reason (i32.load offset=132 (local.get $frame)))
    (global.set $sleep_yielded (i32.load offset=136 (local.get $frame)))
    (global.set $sleep_timeout (i32.load offset=140 (local.get $frame)))
    (global.set $current_thunk_eip (i32.load offset=144 (local.get $frame)))
    (global.set $handler_set_eip (i32.load offset=148 (local.get $frame)))
    (global.set $message_wait_msg_ptr (i32.load offset=152 (local.get $frame)))
    (global.set $wait_handle (i32.load offset=156 (local.get $frame)))
    (global.set $wait_handles_ptr (i32.load offset=160 (local.get $frame)))
    (global.set $wait_all (i32.load offset=164 (local.get $frame)))
    (global.set $wait_timeout (i32.load offset=168 (local.get $frame)))
    (global.set $wait_stack_bytes (i32.load offset=172 (local.get $frame)))
    (global.set $cs_wait_addr (i32.load offset=176 (local.get $frame)))
    (global.set $cs_wait_owner (i32.load offset=180 (local.get $frame)))
    (global.set $cs_wait_spins (i32.load offset=184 (local.get $frame)))
    (global.set $cs_park_pending (i32.load offset=188 (local.get $frame)))
    (global.set $cs_resume_esp_delta (i32.load offset=192 (local.get $frame)))
    (global.set $vblank_wait_active (i32.load offset=196 (local.get $frame)))
    (global.set $vblank_wait_counter (i32.load offset=200 (local.get $frame)))
    (global.set $vblank_deadline_ms (i32.load offset=204 (local.get $frame)))
    (global.set $spin_deadline_ms (i32.load offset=208 (local.get $frame)))
    (global.set $clock_spin_parked_value (i32.load offset=212 (local.get $frame)))
    (global.set $clock_spin_parked_valid (i32.load offset=216 (local.get $frame)))
    (global.set $loadlib_name_ptr (i32.load offset=220 (local.get $frame)))
    (global.set $last_error (i32.load offset=224 (local.get $frame)))
    (global.set $fpu_value0 (f64.reinterpret_i64 (i64.load offset=232 (local.get $frame))))
    (global.set $fpu_value1 (f64.reinterpret_i64 (i64.load offset=240 (local.get $frame))))
    (global.set $fpu_value2 (f64.reinterpret_i64 (i64.load offset=248 (local.get $frame))))
    (global.set $fpu_value3 (f64.reinterpret_i64 (i64.load offset=256 (local.get $frame))))
    (global.set $fpu_value4 (f64.reinterpret_i64 (i64.load offset=264 (local.get $frame))))
    (global.set $fpu_value5 (f64.reinterpret_i64 (i64.load offset=272 (local.get $frame))))
    (global.set $fpu_value6 (f64.reinterpret_i64 (i64.load offset=280 (local.get $frame))))
    (global.set $fpu_value7 (f64.reinterpret_i64 (i64.load offset=288 (local.get $frame))))
    (global.set $fpu_raw0 (i64.load offset=296 (local.get $frame)))
    (global.set $fpu_raw1 (i64.load offset=304 (local.get $frame)))
    (global.set $fpu_raw2 (i64.load offset=312 (local.get $frame)))
    (global.set $fpu_raw3 (i64.load offset=320 (local.get $frame)))
    (global.set $fpu_raw4 (i64.load offset=328 (local.get $frame)))
    (global.set $fpu_raw5 (i64.load offset=336 (local.get $frame)))
    (global.set $fpu_raw6 (i64.load offset=344 (local.get $frame)))
    (global.set $fpu_raw7 (i64.load offset=352 (local.get $frame)))
    (global.set $mm0 (i64.load offset=360 (local.get $frame)))
    (global.set $mm1 (i64.load offset=368 (local.get $frame)))
    (global.set $mm2 (i64.load offset=376 (local.get $frame)))
    (global.set $mm3 (i64.load offset=384 (local.get $frame)))
    (global.set $mm4 (i64.load offset=392 (local.get $frame)))
    (global.set $mm5 (i64.load offset=400 (local.get $frame)))
    (global.set $mm6 (i64.load offset=408 (local.get $frame)))
    (global.set $mm7 (i64.load offset=416 (local.get $frame)))
    (global.set $xmm0l (i64.load offset=424 (local.get $frame)))
    (global.set $xmm0h (i64.load offset=432 (local.get $frame)))
    (global.set $xmm1l (i64.load offset=440 (local.get $frame)))
    (global.set $xmm1h (i64.load offset=448 (local.get $frame)))
    (global.set $xmm2l (i64.load offset=456 (local.get $frame)))
    (global.set $xmm2h (i64.load offset=464 (local.get $frame)))
    (global.set $xmm3l (i64.load offset=472 (local.get $frame)))
    (global.set $xmm3h (i64.load offset=480 (local.get $frame)))
    (global.set $xmm4l (i64.load offset=488 (local.get $frame)))
    (global.set $xmm4h (i64.load offset=496 (local.get $frame)))
    (global.set $xmm5l (i64.load offset=504 (local.get $frame)))
    (global.set $xmm5h (i64.load offset=512 (local.get $frame)))
    (global.set $xmm6l (i64.load offset=520 (local.get $frame)))
    (global.set $xmm6h (i64.load offset=528 (local.get $frame)))
    (global.set $xmm7l (i64.load offset=536 (local.get $frame)))
    (global.set $xmm7h (i64.load offset=544 (local.get $frame)))
    (global.set $delphi_seh_rec (i32.load offset=552 (local.get $frame)))
    (global.set $delphi_exception_record (i32.load offset=556 (local.get $frame)))
    (global.set $delphi_seh_head_before (i32.load offset=560 (local.get $frame)))
    (global.set $ip (i32.const 0))
    (global.set $resume_ip (i32.const 0))
    (global.set $steps (i32.const 0)))

  ;; Save caller-saved registers + lazy flags onto guest stack (9 dwords = 36 bytes)
  (func $save_caller_regs
    (global.set $esp (i32.sub (global.get $esp) (i32.const 36)))
    (call $gs32 (global.get $esp)                         (global.get $eip))
    (call $gs32 (i32.add (global.get $esp) (i32.const 4))  (global.get $eax))
    (call $gs32 (i32.add (global.get $esp) (i32.const 8))  (global.get $ecx))
    (call $gs32 (i32.add (global.get $esp) (i32.const 12)) (global.get $edx))
    (call $gs32 (i32.add (global.get $esp) (i32.const 16)) (global.get $flag_op))
    (call $gs32 (i32.add (global.get $esp) (i32.const 20)) (global.get $flag_res))
    (call $gs32 (i32.add (global.get $esp) (i32.const 24)) (global.get $flag_a))
    (call $gs32 (i32.add (global.get $esp) (i32.const 28)) (global.get $flag_b))
    (call $gs32 (i32.add (global.get $esp) (i32.const 32)) (global.get $flag_sign_shift)))

  ;; Restore caller-saved registers + lazy flags from guest stack
  (func $restore_caller_regs
    (global.set $eip             (call $gl32 (global.get $esp)))
    (global.set $eax             (call $gl32 (i32.add (global.get $esp) (i32.const 4))))
    (global.set $ecx             (call $gl32 (i32.add (global.get $esp) (i32.const 8))))
    (global.set $edx             (call $gl32 (i32.add (global.get $esp) (i32.const 12))))
    (global.set $flag_op         (call $gl32 (i32.add (global.get $esp) (i32.const 16))))
    (global.set $flag_res        (call $gl32 (i32.add (global.get $esp) (i32.const 20))))
    (global.set $flag_a          (call $gl32 (i32.add (global.get $esp) (i32.const 24))))
    (global.set $flag_b          (call $gl32 (i32.add (global.get $esp) (i32.const 28))))
    (global.set $flag_sign_shift (call $gl32 (i32.add (global.get $esp) (i32.const 32))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 36))))
