;; Graceful render-instance heap handoff. The producer must have destroyed all
;; devices/programs/contexts before retirement and must never allocate afterward.
;; The receiver may adopt only after confirmed producer termination. These are
;; host lifecycle exports, not guest APIs. Forced-death orphan recovery is separate.
  (func (export "d3d_render_retire_heap") (result i32)
    (local $head i32)
    (call $heap_arena_free_tail (global.get $heap_ptr) (global.get $heap_end) (global.get $heap_arena_record))
    (call $heap_arena_free_tail (global.get $heap_sparse_ptr) (global.get $heap_sparse_end) (global.get $heap_sparse_record))
    (local.set $head (global.get $free_list))
    (global.set $free_list (i32.const 0))
    (global.set $heap_ptr (i32.const 0))
    (global.set $heap_end (i32.const 0))
    (global.set $heap_arena_record (i32.const 0))
    (global.set $heap_sparse_ptr (i32.const 0))
    (global.set $heap_sparse_end (i32.const 0))
    (global.set $heap_sparse_record (i32.const 0))
    (local.get $head))

  ;; Validated walk returns the terminal block (or -1). Count bound detects
  ;; cycles without allocation and caps hostile/corrupted-list work. Both chains
  ;; are validated before linking; equal tails mean intersection/double adoption.
  (func $d3d_render_list_tail (param $head i32) (result i32)
    (local $cur i32) (local $tail i32) (local $wa i32) (local $count i32)
    (local.set $cur (local.get $head))
    (block $done (loop $walk
      (br_if $done (i32.eqz (local.get $cur)))
      (if (i32.ge_u (local.get $count) (i32.const 65536)) (then (return (i32.const -1))))
      (if (i32.ne (i32.and (local.get $cur) (i32.const 7)) (i32.const 0)) (then (return (i32.const -1))))
      (if (i32.eqz (call $heap_arena_find (local.get $cur))) (then (return (i32.const -1))))
      (local.set $wa (call $g2w (local.get $cur)))
      (if (i32.or (i32.lt_u (local.get $wa) (i32.const 256))
        (i64.gt_u (i64.add (i64.extend_i32_u (local.get $wa)) (i64.const 8))
          (i64.shl (i64.extend_i32_u (memory.size)) (i64.const 16)))) (then (return (i32.const -1))))
      (if (call $heap_block_bad (local.get $cur) (i32.load (local.get $wa))) (then (return (i32.const -1))))
      (local.set $tail (local.get $cur))
      (local.set $cur (i32.load offset=4 (local.get $wa)))
      (local.set $count (i32.add (local.get $count) (i32.const 1)))
      (br $walk)))
    (local.get $tail))

  ;; Called only between render submissions. The free list is instance-local;
  ;; other instances own disjoint lists even though arena records are shared.
  ;; No allocations, live-block moves, retired-tail adoption or guest CPU state
  ;; changes. Bottom-up merge sort bounds work to O(n log n), n<=65536.
  (func (export "d3d_render_coalesce_heap") (result i32)
    (local $head i32) (local $width i32) (local $p i32) (local $q i32)
    (local $psize i32) (local $qsize i32) (local $item i32) (local $tail i32)
    (local $newhead i32) (local $merges i32) (local $cur i32) (local $next i32)
    (local $wa i32) (local $size i32) (local $joined i32) (local $by_size i32)
    (local.set $head (global.get $free_list))
    (if (i32.eq (call $d3d_render_list_tail (local.get $head)) (i32.const -1))
      (then (return (i32.const -1))))
    (if (i32.eqz (local.get $head)) (then (return (i32.const 0))))
    (loop $order (result i32)
    (local.set $width (i32.const 1))
    (loop $sort
      (local.set $p (local.get $head))
      (local.set $newhead (i32.const 0)) (local.set $tail (i32.const 0))
      (local.set $merges (i32.const 0))
      (block $pass_done (loop $runs
        (br_if $pass_done (i32.eqz (local.get $p)))
        (local.set $merges (i32.add (local.get $merges) (i32.const 1)))
        (local.set $q (local.get $p)) (local.set $psize (i32.const 0))
        (block $split_done (loop $split
          (br_if $split_done (i32.eqz (local.get $q)))
          (br_if $split_done (i32.eq (local.get $psize) (local.get $width)))
          (local.set $psize (i32.add (local.get $psize) (i32.const 1)))
          (local.set $q (i32.load offset=4 (call $g2w (local.get $q))))
          (br $split)))
        (local.set $qsize (local.get $width))
        (block $merge_done (loop $merge
          (br_if $merge_done (i32.and (i32.eqz (local.get $psize))
            (i32.or (i32.eqz (local.get $qsize)) (i32.eqz (local.get $q)))))
          (if (i32.and (i32.ne (local.get $psize) (i32.const 0))
            (i32.or (i32.eqz (local.get $qsize))
              (i32.or (i32.eqz (local.get $q))
                (if (result i32) (local.get $by_size)
                  (then (i32.le_u (i32.load (call $g2w (local.get $p))) (i32.load (call $g2w (local.get $q)))))
                  (else (i32.le_u (local.get $p) (local.get $q)))))))
            (then
              (local.set $item (local.get $p))
              (local.set $p (i32.load offset=4 (call $g2w (local.get $p))))
              (local.set $psize (i32.sub (local.get $psize) (i32.const 1))))
            (else
              (local.set $item (local.get $q))
              (local.set $q (i32.load offset=4 (call $g2w (local.get $q))))
              (local.set $qsize (i32.sub (local.get $qsize) (i32.const 1)))))
          (if (local.get $tail)
            (then (i32.store offset=4 (call $g2w (local.get $tail)) (local.get $item)))
            (else (local.set $newhead (local.get $item))))
          (local.set $tail (local.get $item)) (br $merge)))
        (local.set $p (local.get $q)) (br $runs)))
      (i32.store offset=4 (call $g2w (local.get $tail)) (i32.const 0))
      (local.set $head (local.get $newhead))
      (local.set $width (i32.shl (local.get $width) (i32.const 1)))
      (br_if $sort (i32.gt_u (local.get $merges) (i32.const 1))))
    (global.set $free_list (local.get $head))
    (if (local.get $by_size) (then (return (local.get $joined))))
    ;; Validate disjointness before changing any block size. On overlap the
    ;; links remain sorted but every original block/header is retained.
    (local.set $cur (local.get $head))
    (block $checked (loop $check
      (local.set $wa (call $g2w (local.get $cur)))
      (local.set $next (i32.load offset=4 (local.get $wa)))
      (br_if $checked (i32.eqz (local.get $next)))
      (if (i64.gt_u (i64.add (i64.extend_i32_u (local.get $cur))
        (i64.extend_i32_u (i32.load (local.get $wa)))) (i64.extend_i32_u (local.get $next)))
        (then (return (i32.const -1))))
      (local.set $cur (local.get $next)) (br $check)))
    (local.set $cur (local.get $head))
    (block $done (loop $coalesce
      (local.set $wa (call $g2w (local.get $cur)))
      (local.set $size (i32.load (local.get $wa)))
      (local.set $next (i32.load offset=4 (local.get $wa)))
      (br_if $done (i32.eqz (local.get $next)))
      (if (i32.and (i32.eq (i32.add (local.get $cur) (local.get $size)) (local.get $next))
        (i32.eq (call $heap_arena_find (local.get $cur)) (call $heap_arena_find (local.get $next))))
        (then
          (i32.store (local.get $wa) (i32.add (local.get $size) (i32.load (call $g2w (local.get $next)))))
          (i32.store offset=4 (local.get $wa) (i32.load offset=4 (call $g2w (local.get $next))))
          (local.set $joined (i32.add (local.get $joined) (i32.const 1))))
        (else (local.set $cur (local.get $next))))
      (br $coalesce)))
    ;; First-fit allocation must not consume a large texture-sized free block
    ;; for tiny shader packets before that texture is rebound. Sorting the
    ;; coalesced blocks by size preserves smaller fits at the next submission.
    (local.set $by_size (i32.const 1))
    (br $order)))

  (func (export "d3d_render_adopt_free_list") (param $head i32) (result i32)
    (local $tail i32) (local $oldtail i32) (local $cur i32) (local $count i32)
    (if (i32.eqz (local.get $head)) (then (return (i32.const 0))))
    (local.set $tail (call $d3d_render_list_tail (local.get $head)))
    (local.set $oldtail (call $d3d_render_list_tail (global.get $free_list)))
    (if (i32.or (i32.eq (local.get $tail) (i32.const -1))
      (i32.or (i32.eq (local.get $oldtail) (i32.const -1))
        (i32.eq (local.get $tail) (local.get $oldtail)))) (then (return (i32.const -1))))
    (local.set $cur (local.get $head))
    (loop $count
      (local.set $count (i32.add (local.get $count) (i32.const 1)))
      (local.set $cur (i32.load offset=4 (call $g2w (local.get $cur))))
      (br_if $count (local.get $cur)))
    (i32.store offset=4 (call $g2w (local.get $tail)) (global.get $free_list))
    (global.set $free_list (local.get $head))
    (local.get $count))
