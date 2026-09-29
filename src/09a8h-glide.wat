  ;; Glide 2 ABI: original 3dfx glide2x/cvg/glide/src/glide.h at
  ;; sezero/glide 2f226f0f9225ce8ee83e6a4a7042981e719d19ee.
  ;; One virtual Voodoo Graphics board, one TMU with 4 MiB texture memory.
  ;; Shared block: +0/+4 recursive lock; +8 initialized; +12 open;
  ;; +16 stream pointer, +20 used; +24 width,+28 height; +32 callback;
  ;; +36 triangle count; +40 LFB guest pointer; +44 stream guest pointer;
  ;; +48 LFB lock kind; +52 locked buffer; +256 pipeline state; +512 scratch.
  ;; All handlers take the shared lock, including state setters. No setter
  ;; performs host RPC. Command records contain immutable copied arguments.

  (global $GLIDE_STATE i32 (region.addr $GLIDE_STATE 0))
  (global $GLIDE_STATE_SIZE i32 (region.size $GLIDE_STATE))

  (func $glide_fail
    (call $host_log_i32 (i32.const 0x474c4944))
    (unreachable))

  (func $glide_flush
    (local $n i32)
    (local.set $n (i32.load offset=20 (global.get $GLIDE_STATE)))
    (if (local.get $n) (then
      (if (i32.ne (call $host_glide_submit (i32.const 0)
        (i32.load offset=16 (global.get $GLIDE_STATE)) (local.get $n)) (i32.const 1))
        (then (call $glide_fail)))
      (i32.store offset=20 (global.get $GLIDE_STATE) (i32.const 0)))))

  (func $glide_init
    (local $p i32)
    (if (i32.eqz (i32.load offset=16 (global.get $GLIDE_STATE))) (then
      (local.set $p (call $gl_alloc_affine (i32.const 1048576)))
      (if (i32.eqz (local.get $p)) (then (call $glide_fail)))
      (i32.store offset=44 (global.get $GLIDE_STATE) (local.get $p))
      (i32.store offset=16 (global.get $GLIDE_STATE) (call $g2w (local.get $p)))))
    (i32.store offset=8 (global.get $GLIDE_STATE) (i32.const 1)))

  (func $glide_state (result i32) (region.addr $GLIDE_STATE 256))
  (func $glide_scratch (result i32) (region.addr $GLIDE_STATE 512))

  (func $glide_record (param $op i32) (param $len i32) (result i32)
    (local $n i32) (local $p i32) (local $padded i32)
    (if (i32.eqz (i32.load offset=12 (global.get $GLIDE_STATE)))
      (then (call $glide_fail)))
    (local.set $padded (i32.and (i32.add (local.get $len) (i32.const 3)) (i32.const -4)))
    (if (i32.gt_u (local.get $padded) (i32.const 1048568)) (then (call $glide_fail)))
    (local.set $n (i32.load offset=20 (global.get $GLIDE_STATE)))
    (if (i32.gt_u (i32.add (local.get $n) (i32.add (local.get $padded) (i32.const 8)))
          (i32.const 1048576)) (then (call $glide_flush) (local.set $n (i32.const 0))))
    (local.set $p (i32.add (i32.load offset=16 (global.get $GLIDE_STATE)) (local.get $n)))
    (i32.store (local.get $p) (local.get $op))
    (i32.store offset=4 (local.get $p) (local.get $len))
    (i32.store offset=20 (global.get $GLIDE_STATE)
      (i32.add (local.get $n) (i32.add (local.get $padded) (i32.const 8))))
    (i32.add (local.get $p) (i32.const 8)))

  (func $glide_check_guest (param $guest i32) (param $n i32)
    (if (i32.or (i32.eqz (local.get $guest))
      (i32.lt_u (i32.add (local.get $guest) (local.get $n)) (local.get $guest)))
      (then (call $glide_fail))))

  (func $glide_copy_guest (param $dst i32) (param $guest i32) (param $n i32)
    (local $src i32)
    (call $glide_check_guest (local.get $guest) (local.get $n))
    (local.set $src (call $guest_span_in (local.get $guest) (local.get $n)))
    (memory.copy (local.get $dst) (local.get $src) (local.get $n))
    (call $guest_span_release (local.get $src) (local.get $n)))

  (func $glide_tmu (param $tmu i32)
    (if (local.get $tmu) (then (call $glide_fail))))

  ;; Original 3dfx sst1/gsplash.c (same pinned revision) defines SNAP_BIAS
  ;; as 3<<18 and passes projected coordinates PLUS this bias directly to
  ;; grDrawTriangle (lines 633-638, 676-685). The hardware's signed 12.4
  ;; coordinate conversion discards that integer multiple of 4096. Decode
  ;; exactly that alternate coordinate interval, including negative screen
  ;; positions; never subtract a guessed offset from arbitrary large values.
  ;; No hint enables this convention: Glide's own splash uses it unconditionally.
  (func $glide_coordinate (param $x f32) (result f32)
    (if (result f32) (i32.and
        (f32.ge (local.get $x) (f32.const 784384))
        (f32.lt (local.get $x) (f32.const 788480)))
      (then (f32.sub (local.get $x) (f32.const 786432)))
      (else (local.get $x))))

  (func $glide_copy_vertex (param $dst i32) (param $guest i32)
    (call $glide_copy_guest (local.get $dst) (local.get $guest) (i32.const 60))
    (f32.store (local.get $dst) (call $glide_coordinate (f32.load (local.get $dst))))
    (f32.store offset=4 (local.get $dst)
      (call $glide_coordinate (f32.load offset=4 (local.get $dst)))))

  ;; Glide 2 LOD enums run 256=0 through 1=8. Each selected level occupies
  ;; its dimensions * bytes-per-pixel; complete allocations align to 8 bytes.
  (func $glide_tex_bytes (param $small i32) (param $large i32)
      (param $aspect i32) (param $format i32) (param $mask i32) (result i32)
    (local $lod i32) (local $w i32) (local $h i32) (local $n i32)
    (if (i32.or (i32.gt_u (local.get $small) (i32.const 8))
      (i32.or (i32.gt_u (local.get $large) (local.get $small))
      (i32.or (i32.gt_u (local.get $aspect) (i32.const 6))
      (i32.or (i32.gt_u (local.get $format) (i32.const 15))
      (i32.or (i32.eqz (local.get $mask)) (i32.gt_u (local.get $mask) (i32.const 3)))))))
      (then (call $glide_fail)))
    (local.set $lod (local.get $large))
    (loop $levels
      (if (i32.and (local.get $mask) (i32.shl (i32.const 1)
          (i32.and (local.get $lod) (i32.const 1)))) (then
        (local.set $w (i32.shr_u (i32.const 256) (local.get $lod)))
        (local.set $h (local.get $w))
        (if (i32.lt_u (local.get $aspect) (i32.const 3))
          (then (local.set $h (i32.shr_u (local.get $h) (i32.sub (i32.const 3) (local.get $aspect))))))
        (if (i32.gt_u (local.get $aspect) (i32.const 3))
          (then (local.set $w (i32.shr_u (local.get $w) (i32.sub (local.get $aspect) (i32.const 3))))))
        (if (i32.eqz (local.get $w)) (then (local.set $w (i32.const 1))))
        (if (i32.eqz (local.get $h)) (then (local.set $h (i32.const 1))))
        (local.set $n (i32.add (local.get $n)
          (i32.shl (i32.mul (local.get $w) (local.get $h))
            (i32.ge_u (local.get $format) (i32.const 8)))))))
      (local.set $lod (i32.add (local.get $lod) (i32.const 1)))
      (br_if $levels (i32.le_u (local.get $lod) (local.get $small))))
    (local.get $n))

  (func $glide_triangle (param $a i32) (param $b i32) (param $c i32)
    (local $p i32)
    (local.set $p (call $glide_record (i32.const 5) (i32.const 436)))
    (memory.copy (local.get $p) (call $glide_state) (i32.const 256))
    (call $glide_copy_vertex (i32.add (local.get $p) (i32.const 256)) (local.get $a))
    (call $glide_copy_vertex (i32.add (local.get $p) (i32.const 316)) (local.get $b))
    (call $glide_copy_vertex (i32.add (local.get $p) (i32.const 376)) (local.get $c))
    (i32.store offset=36 (global.get $GLIDE_STATE)
      (i32.add (i32.load offset=36 (global.get $GLIDE_STATE)) (i32.const 1))))

  ;; Retain topology explicitly. Thin lines and points must reach each
  ;; backend's native coverage rules, rather than pretending to be triangles.
  (func $glide_small_primitive (param $op i32) (param $a i32) (param $b i32)
    (local $p i32)
    (local.set $p (call $glide_record (local.get $op)
      (if (result i32) (i32.eq (local.get $op) (i32.const 11))
        (then (i32.const 376)) (else (i32.const 316)))))
    (memory.copy (local.get $p) (call $glide_state) (i32.const 256))
    (call $glide_copy_vertex (i32.add (local.get $p) (i32.const 256)) (local.get $a))
    (if (i32.eq (local.get $op) (i32.const 11)) (then
      (call $glide_copy_vertex (i32.add (local.get $p) (i32.const 316)) (local.get $b)))))
  ;; LFB staging is affine guest memory kept stable until unlock. The host
  ;; reads/writes the packet synchronously; it never retains a guest pointer.
  (func $glide_lfb_stage (param $buffer i32) (param $origin i32) (result i32)
    (local $guest i32) (local $p i32) (local $n i32)
    (if (i32.or (i32.eqz (i32.load offset=12 (global.get $GLIDE_STATE)))
      (i32.or (i32.gt_u (local.get $buffer) (i32.const 1))
        (i32.gt_u (local.get $origin) (i32.const 1)))) (then (return (i32.const 0))))
    (call $glide_flush)
    (local.set $guest (i32.load offset=40 (global.get $GLIDE_STATE)))
    (if (i32.eqz (local.get $guest)) (then
      (local.set $guest (call $gl_alloc_affine (i32.const 1572884)))
      (if (i32.eqz (local.get $guest)) (then (return (i32.const 0))))
      (i32.store offset=40 (global.get $GLIDE_STATE) (local.get $guest))))
    (local.set $p (call $g2w (local.get $guest)))
    (i32.store (local.get $p) (local.get $buffer))
    (i32.store offset=4 (local.get $p) (local.get $origin))
    (i32.store offset=8 (local.get $p) (i32.const 0))
    (i32.store offset=12 (local.get $p) (i32.load offset=24 (global.get $GLIDE_STATE)))
    (i32.store offset=16 (local.get $p) (i32.load offset=28 (global.get $GLIDE_STATE)))
    (local.set $n (i32.add (i32.const 20) (i32.mul
      (i32.mul (i32.load offset=24 (global.get $GLIDE_STATE))
        (i32.load offset=28 (global.get $GLIDE_STATE))) (i32.const 2))))
    (if (i32.eqz (call $host_glide_submit (i32.const 9) (local.get $p) (local.get $n)))
      (then (return (i32.const 0))))
    (local.get $p))

  (func $glide_lfb_publish (param $p i32) (result i32)
    (call $host_glide_submit (i32.const 10) (local.get $p)
      (i32.add (i32.const 20) (i32.mul (i32.mul
        (i32.load offset=12 (local.get $p)) (i32.load offset=16 (local.get $p))) (i32.const 2)))))

  ;; Fullscreen ownership is shared across instances, like DirectDraw's mode.
  ;; +56 target HWND, +60 saved-mode flag, +64 previous DX state (32 bytes),
  ;; +96 original window RECT. No guest callback runs synchronously here.
  (func $glide_display_target (param $hwnd i32) (result i32)
    (if (i32.eqz (local.get $hwnd)) (then (local.set $hwnd (call $dx_target_hwnd))))
    (if (i32.eqz (local.get $hwnd)) (then (local.set $hwnd (call $host_foreground_window))))
    (memory.fill (region.addr $GLIDE_STATE 96) (i32.const 0) (i32.const 16))
    (if (local.get $hwnd) (then
      (call $host_get_window_rect (local.get $hwnd) (region.addr $GLIDE_STATE 96))))
    ;; A missing HWND must not create a phantom window or restore a zero RECT.
    (if (i32.or
      (i32.le_s (i32.load offset=104 (global.get $GLIDE_STATE)) (i32.load offset=96 (global.get $GLIDE_STATE)))
      (i32.le_s (i32.load offset=108 (global.get $GLIDE_STATE)) (i32.load offset=100 (global.get $GLIDE_STATE))))
      (then (return (i32.const 0))))
    (local.get $hwnd))

  (func $glide_display_take (param $hwnd i32) (param $w i32) (param $h i32)
    (memory.copy (region.addr $GLIDE_STATE 64) (global.get $DX_PROCESS_STATE) (i32.const 32))
    (i32.store offset=56 (global.get $GLIDE_STATE) (local.get $hwnd))
    (i32.store offset=60 (global.get $GLIDE_STATE) (i32.const 1))
    (call $dx_display_w_set (local.get $w))
    (call $dx_display_h_set (local.get $h))
    (call $dx_display_bpp_set (i32.const 16))
    (call $dx_display_mode_set (i32.const 1))
    (call $dx_display_fullscreen_set (i32.const 1))
    (call $dx_coop_hwnd_set (local.get $hwnd))
    (call $dx_exclusive_set (i32.ne (local.get $hwnd) (i32.const 0)))
    (if (local.get $hwnd) (then
      (call $host_move_window (local.get $hwnd) (i32.const 0) (i32.const 0)
        (local.get $w) (local.get $h) (i32.const 0))
      (call $client_rect_set (local.get $hwnd) (i32.const 0) (i32.const 0) (local.get $w) (local.get $h)))))

  (func $glide_display_restore
    (local $hwnd i32) (local $rect i32)
    (if (i32.eqz (i32.load offset=60 (global.get $GLIDE_STATE))) (then (return)))
    (i32.store offset=60 (global.get $GLIDE_STATE) (i32.const 0))
    (memory.copy (global.get $DX_PROCESS_STATE) (region.addr $GLIDE_STATE 64) (i32.const 32))
    (local.set $hwnd (i32.load offset=56 (global.get $GLIDE_STATE)))
    (if (local.get $hwnd) (then
      ;; Window may have been destroyed before grGlideShutdown.
      (local.set $rect (call $paint_scratch_take))
      (memory.fill (local.get $rect) (i32.const 0) (i32.const 16))
      (call $host_get_window_rect (local.get $hwnd) (local.get $rect))
      (if (i32.and (i32.gt_s (i32.load offset=8 (local.get $rect)) (i32.load (local.get $rect)))
          (i32.gt_s (i32.load offset=12 (local.get $rect)) (i32.load offset=4 (local.get $rect)))) (then
        (call $host_move_window (local.get $hwnd)
          (i32.load offset=96 (global.get $GLIDE_STATE)) (i32.load offset=100 (global.get $GLIDE_STATE))
          (i32.sub (i32.load offset=104 (global.get $GLIDE_STATE)) (i32.load offset=96 (global.get $GLIDE_STATE)))
          (i32.sub (i32.load offset=108 (global.get $GLIDE_STATE)) (i32.load offset=100 (global.get $GLIDE_STATE)))
          (i32.const 0))
        (call $defwndproc_do_nccalcsize (local.get $hwnd)))))))

  ;; Guest API entry points.


  (func $handle_grGlideInit
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_init)
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grGlideShutdown
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_flush)
    (if (i32.load offset=12 (global.get $GLIDE_STATE)) (then
        (if (i32.ne (call $host_glide_submit (i32.const 2) (i32.const 0) (i32.const 0)) (i32.const 1))
          (then (call $glide_fail)))))
    (call $glide_display_restore)
    (local.set $p (i32.load offset=44 (global.get $GLIDE_STATE)))
    (if (local.get $p) (then (call $heap_free (local.get $p))))
    (local.set $p (i32.load offset=40 (global.get $GLIDE_STATE)))
    (if (local.get $p) (then (call $heap_free (local.get $p))))
    (memory.fill (region.addr $GLIDE_STATE 8) (i32.const 0) (i32.const 248))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grSstWinClose
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_flush)
    (if (i32.load offset=12 (global.get $GLIDE_STATE)) (then
        (if (i32.ne (call $host_glide_submit (i32.const 2) (i32.const 0) (i32.const 0)) (i32.const 1))
          (then (call $glide_fail)))))
    (call $glide_display_restore)
    (i32.store offset=48 (global.get $GLIDE_STATE) (i32.const 0))
    (i32.store offset=12 (global.get $GLIDE_STATE) (i32.const 0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grSstQueryHardware
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_check_guest (local.get $arg0) (i32.const 148))
    (local.set $p (call $guest_span_in (local.get $arg0) (i32.const 148)))
    (memory.fill (local.get $p) (i32.const 0) (i32.const 148))
    (i32.store offset=0 (local.get $p) (i32.const 1))
    (i32.store offset=8 (local.get $p) (i32.const 4))
    (i32.store offset=12 (local.get $p) (i32.const 2))
    (i32.store offset=16 (local.get $p) (i32.const 1))
    (i32.store offset=24 (local.get $p) (i32.const 1))
    (i32.store offset=28 (local.get $p) (i32.const 4))
    (call $guest_span_writeback (local.get $arg0) (local.get $p) (i32.const 148))
    (i32.store offset=0 (global.get $reg_base) (i32.const 1))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grGlideGetVersion
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_check_guest (local.get $arg0) (i32.const 19))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 0)) (i32.const 50))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 1)) (i32.const 46))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 2)) (i32.const 52))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 3)) (i32.const 51))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 4)) (i32.const 32))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 5)) (i32.const 87))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 6)) (i32.const 105))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 7)) (i32.const 110))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 8)) (i32.const 101))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 9)) (i32.const 32))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 10)) (i32.const 65))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 11)) (i32.const 115))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 12)) (i32.const 115))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 13)) (i32.const 101))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 14)) (i32.const 109))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 15)) (i32.const 98))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 16)) (i32.const 108))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 17)) (i32.const 121))
    (call $gs8 (i32.add (local.get $arg0) (i32.const 18)) (i32.const 0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grSstSelect
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (if (local.get $arg0) (then (call $glide_fail)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grSstScreenWidth
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=0 (global.get $reg_base) (i32.load offset=24 (global.get $GLIDE_STATE)))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grSstScreenHeight
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=0 (global.get $reg_base) (i32.load offset=28 (global.get $GLIDE_STATE)))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grSstIdle
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_flush)
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grSstStatus
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_flush)
    (i32.store offset=0 (global.get $reg_base) (i32.or (i32.const 268431423)
        (i32.shl (i32.eqz (call $vblank_in_blank (call $host_get_ticks))) (i32.const 6))))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grSstVRetraceOn
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=0 (global.get $reg_base) (call $vblank_in_blank (call $host_get_ticks)))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  (func $handle_grErrorSetCallback
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=32 (global.get $GLIDE_STATE) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grSstControl
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $r i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    ;; Activation gates presentation; resize/move of the fixed virtual video
    ;; mode are unsupported and return the specified FxBool failure.
    (if (i32.or (i32.eq (local.get $arg0) (i32.const 1))
        (i32.eq (local.get $arg0) (i32.const 2))) (then
        (i32.store offset=244 (call $glide_state) (i32.eq (local.get $arg0) (i32.const 1)))
        (local.set $r (i32.const 1))))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grSstWinOpen
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (local $r i32) (local $hwnd i32)
    (local $w i32) (local $h i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_init) (call $glide_flush)
    (if (i32.load offset=12 (global.get $GLIDE_STATE)) (then (call $glide_fail)))
    (if (i32.or (i32.gt_u (local.get $arg3) (i32.const 3)) (i32.or (i32.gt_u (local.get $arg4) (i32.const 1)) (i32.or (i32.ne (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))) (i32.const 2)) (i32.gt_u (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))) (i32.const 1))))) (then (call $glide_fail)))
    (if (i32.eq (local.get $arg1) (i32.const 0)) (then (local.set $w (i32.const 320)) (local.set $h (i32.const 200))))
    (if (i32.eq (local.get $arg1) (i32.const 1)) (then (local.set $w (i32.const 320)) (local.set $h (i32.const 240))))
    (if (i32.eq (local.get $arg1) (i32.const 2)) (then (local.set $w (i32.const 400)) (local.set $h (i32.const 256))))
    (if (i32.eq (local.get $arg1) (i32.const 3)) (then (local.set $w (i32.const 512)) (local.set $h (i32.const 384))))
    (if (i32.eq (local.get $arg1) (i32.const 4)) (then (local.set $w (i32.const 640)) (local.set $h (i32.const 200))))
    (if (i32.eq (local.get $arg1) (i32.const 5)) (then (local.set $w (i32.const 640)) (local.set $h (i32.const 350))))
    (if (i32.eq (local.get $arg1) (i32.const 6)) (then (local.set $w (i32.const 640)) (local.set $h (i32.const 400))))
    (if (i32.eq (local.get $arg1) (i32.const 7)) (then (local.set $w (i32.const 640)) (local.set $h (i32.const 480))))
    (if (i32.eq (local.get $arg1) (i32.const 8)) (then (local.set $w (i32.const 800)) (local.set $h (i32.const 600))))
    (if (i32.eq (local.get $arg1) (i32.const 9)) (then (local.set $w (i32.const 960)) (local.set $h (i32.const 720))))
    (if (i32.eq (local.get $arg1) (i32.const 10)) (then (local.set $w (i32.const 856)) (local.set $h (i32.const 480))))
    (if (i32.eq (local.get $arg1) (i32.const 11)) (then (local.set $w (i32.const 512)) (local.set $h (i32.const 256))))
    (if (i32.eq (local.get $arg1) (i32.const 12)) (then (local.set $w (i32.const 1024)) (local.set $h (i32.const 768))))
    (if (i32.eqz (local.get $w)) (then (call $glide_fail)))
    (memory.fill (call $glide_state) (i32.const 0) (i32.const 256))
    (i32.store offset=0 (call $glide_state) (i32.const 1))
    (i32.store offset=8 (call $glide_state) (i32.const 0))
    (i32.store offset=20 (call $glide_state) (i32.const 1))
    (i32.store offset=28 (call $glide_state) (i32.const 0))
    (i32.store offset=40 (call $glide_state) (i32.const 4294967295))
    (i32.store offset=48 (call $glide_state) (i32.const 1))
    (i32.store offset=52 (call $glide_state) (i32.const 1))
    (i32.store offset=56 (call $glide_state) (i32.const 4))
    (i32.store offset=64 (call $glide_state) (i32.const 4))
    (i32.store offset=72 (call $glide_state) (i32.const 7))
    (i32.store offset=120 (call $glide_state) (i32.const 1))
    (i32.store offset=124 (call $glide_state) (i32.const 1))
    (i32.store offset=148 (call $glide_state) (i32.const 3))
    (i32.store offset=180 (call $glide_state) (i32.const 1))
    (i32.store offset=184 (call $glide_state) (i32.const 1))
    (i32.store offset=192 (call $glide_state) (i32.const 1))
    (i32.store offset=212 (call $glide_state) (i32.const 1065353216))
    (i32.store offset=244 (call $glide_state) (i32.const 1))
    (i32.store offset=100 (call $glide_state) (local.get $arg4))(i32.store offset=112 (call $glide_state) (local.get $w))(i32.store offset=116 (call $glide_state) (local.get $h))
    (local.set $hwnd (call $glide_display_target (local.get $arg0)))
    (local.set $p (call $glide_scratch))
    (i32.store offset=0 (local.get $p) (local.get $hwnd))
    (i32.store offset=4 (local.get $p) (local.get $w))
    (i32.store offset=8 (local.get $p) (local.get $h))
    (i32.store offset=12 (local.get $p) (local.get $arg3))
    (i32.store offset=16 (local.get $p) (local.get $arg4))
    (local.set $r (call $host_glide_submit (i32.const 1) (local.get $p) (i32.const 20)))
    (i32.store offset=12 (global.get $GLIDE_STATE) (local.get $r))(i32.store offset=24 (global.get $GLIDE_STATE) (local.get $w))(i32.store offset=28 (global.get $GLIDE_STATE) (local.get $h))
    (if (local.get $r) (then (call $glide_display_take (local.get $hwnd) (local.get $w) (local.get $h))))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))

  (func $handle_grColorCombine
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=0 (call $glide_state) (local.get $arg0))
    (i32.store offset=4 (call $glide_state) (local.get $arg1))
    (i32.store offset=8 (call $glide_state) (local.get $arg2))
    (i32.store offset=12 (call $glide_state) (local.get $arg3))
    (i32.store offset=16 (call $glide_state) (local.get $arg4))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))

  (func $handle_grAlphaCombine
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=20 (call $glide_state) (local.get $arg0))
    (i32.store offset=24 (call $glide_state) (local.get $arg1))
    (i32.store offset=28 (call $glide_state) (local.get $arg2))
    (i32.store offset=32 (call $glide_state) (local.get $arg3))
    (i32.store offset=36 (call $glide_state) (local.get $arg4))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))

  (func $handle_grConstantColorValue
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=40 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grDepthBufferMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=44 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grDepthBufferFunction
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=48 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grDepthMask
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=52 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grAlphaBlendFunction
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=56 (call $glide_state) (local.get $arg0))
    (i32.store offset=60 (call $glide_state) (local.get $arg1))
    (i32.store offset=64 (call $glide_state) (local.get $arg2))
    (i32.store offset=68 (call $glide_state) (local.get $arg3))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_grAlphaTestFunction
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=72 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grAlphaTestReferenceValue
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=76 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grChromakeyMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=80 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grChromakeyValue
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=84 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grFogMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=88 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grFogColorValue
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=92 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grCullMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=96 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grSstOrigin
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=100 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grClipWindow
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=104 (call $glide_state) (local.get $arg0))
    (i32.store offset=108 (call $glide_state) (local.get $arg1))
    (i32.store offset=112 (call $glide_state) (local.get $arg2))
    (i32.store offset=116 (call $glide_state) (local.get $arg3))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_grColorMask
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=120 (call $glide_state) (local.get $arg0))
    (i32.store offset=124 (call $glide_state) (local.get $arg1))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_grRenderBuffer
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=180 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grDepthBiasLevel
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=176 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grDitherMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=208 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grGammaCorrectionValue
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=212 (call $glide_state) (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grHints
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (if (i32.gt_u (local.get $arg0) (i32.const 5)) (then (call $glide_fail)))
    (i32.store (i32.add (call $glide_state) (i32.add (i32.const 216) (i32.shl (local.get $arg0) (i32.const 2)))) (local.get $arg1))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_grTexClampMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=152 (call $glide_state) (local.get $arg1))
    (i32.store offset=156 (call $glide_state) (local.get $arg2))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_grTexFilterMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=160 (call $glide_state) (local.get $arg1))
    (i32.store offset=164 (call $glide_state) (local.get $arg2))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_grTexLodBiasValue
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=172 (call $glide_state) (local.get $arg1))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  ;; Legacy utility mapping from pinned Glide2 sst1/glide/src/digutex.c.
  ;; Detail/trilinear factors retain the same explicit backend limitations as
  ;; grTexCombine; this entry point must not silently replace those factors.
  (func $handle_grTexCombineFunction
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $function i32) (local $factor i32) (local $invert i32)
    (call $glide_tmu (local.get $arg0))
    (if (i32.gt_u (local.get $arg1) (i32.const 10)) (then (call $glide_fail)))
    (if (i32.eq (local.get $arg1) (i32.const 1)) (then (local.set $function (i32.const 1))))
    (if (i32.eq (local.get $arg1) (i32.const 2)) (then (local.set $function (i32.const 3)) (local.set $factor (i32.const 8))))
    (if (i32.eq (local.get $arg1) (i32.const 3)) (then (local.set $function (i32.const 4)) (local.set $factor (i32.const 8))))
    (if (i32.eq (local.get $arg1) (i32.const 4)) (then (local.set $function (i32.const 3)) (local.set $factor (i32.const 1))))
    (if (i32.eq (local.get $arg1) (i32.const 5)) (then (local.set $function (i32.const 6)) (local.set $factor (i32.const 8))))
    (if (i32.eq (local.get $arg1) (i32.const 6)) (then (local.set $function (i32.const 7)) (local.set $factor (i32.const 12))))
    (if (i32.eq (local.get $arg1) (i32.const 7)) (then (local.set $function (i32.const 7)) (local.set $factor (i32.const 4))))
    (if (i32.eq (local.get $arg1) (i32.const 8)) (then (local.set $function (i32.const 7)) (local.set $factor (i32.const 13))))
    (if (i32.eq (local.get $arg1) (i32.const 9)) (then (local.set $function (i32.const 7)) (local.set $factor (i32.const 5))))
    (local.set $invert (i32.eq (local.get $arg1) (i32.const 10)))
    (call $lock_acquire (global.get $GLIDE_STATE))
    (i32.store offset=184 (call $glide_state) (local.get $function))
    (i32.store offset=188 (call $glide_state) (local.get $factor))
    (i32.store offset=192 (call $glide_state) (local.get $function))
    (i32.store offset=196 (call $glide_state) (local.get $factor))
    (i32.store offset=200 (call $glide_state) (local.get $invert))
    (i32.store offset=204 (call $glide_state) (local.get $invert))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  ;; Glide2 gu.c uses float intermediates and normalizes the last entry to 255.
  (func $glide_fog_exp (param $density f32) (param $i i32) (result f32)
    (local $dp f32)
    (local.set $dp (f32.mul (local.get $density)
      (f32.div (f32.convert_i32_u (i32.shl (i32.const 8) (i32.shr_u (local.get $i) (i32.const 2))))
        (f32.convert_i32_u (i32.sub (i32.const 8) (i32.and (local.get $i) (i32.const 3)))))))
    (f32.sub (f32.const 1) (f32.demote_f64 (call $host_math_pow2
      (f64.mul (f64.promote_f32 (f32.neg (local.get $dp))) (f64.const 1.4426950408889634))))))

  (func $handle_guFogGenerateExp
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $i i32) (local $density f32) (local $scale f32) (local $f f32)
    (call $glide_check_guest (local.get $arg0) (i32.const 64))
    (local.set $density (f32.reinterpret_i32 (local.get $arg1)))
    (local.set $scale (f32.div (f32.const 1) (call $glide_fog_exp (local.get $density) (i32.const 63))))
    (loop $entries
      (local.set $f (f32.mul (call $glide_fog_exp (local.get $density) (local.get $i)) (local.get $scale)))
      (call $gs8 (i32.add (local.get $arg0) (local.get $i))
        (i32.trunc_sat_f32_u (f32.mul (f32.const 255) (f32.max (f32.const 0) (f32.min (f32.const 1) (local.get $f))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $entries (i32.lt_u (local.get $i) (i32.const 64))))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_grTexCombine
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=184 (call $glide_state) (local.get $arg1))
    (i32.store offset=188 (call $glide_state) (local.get $arg2))
    (i32.store offset=192 (call $glide_state) (local.get $arg3))
    (i32.store offset=196 (call $glide_state) (local.get $arg4))
    (i32.store offset=200 (call $glide_state) (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (i32.store offset=204 (call $glide_state) (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))

  (func $handle_grTexMipMapMode
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=168 (call $glide_state) (local.get $arg1))(i32.store offset=240 (call $glide_state) (local.get $arg2))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_grTexMinAddress
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grTexMaxAddress
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 4194303))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grTexCalcMemRequired
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $n i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (local.set $n (call $glide_tex_bytes (local.get $arg0) (local.get $arg1) (local.get $arg2) (local.get $arg3) (i32.const 3)))
    (i32.store offset=0 (global.get $reg_base) (i32.and (i32.add (local.get $n) (i32.const 7)) (i32.const -8)))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_grTexTextureMemRequired
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (local $n i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (local.set $p (call $guest_span_in (local.get $arg1) (i32.const 20)))
    (local.set $n (call $glide_tex_bytes (i32.load offset=0 (local.get $p)) (i32.load offset=4 (local.get $p)) (i32.load offset=8 (local.get $p)) (i32.load offset=12 (local.get $p)) (local.get $arg0)))
    (call $guest_span_release (local.get $p) (i32.const 20))
    (i32.store offset=0 (global.get $reg_base) (i32.and (i32.add (local.get $n) (i32.const 7)) (i32.const -8)))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_grTexSource
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $q i32) (local $n i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (call $glide_copy_guest (call $glide_scratch) (local.get $arg3) (i32.const 20))
    (local.set $q (call $glide_scratch))
    (local.set $n (call $glide_tex_bytes (i32.load offset=0 (local.get $q)) (i32.load offset=4 (local.get $q)) (i32.load offset=8 (local.get $q)) (i32.load offset=12 (local.get $q)) (local.get $arg2)))
    (if (i32.or (i32.ne (i32.and (local.get $arg1) (i32.const 7)) (i32.const 0)) (i64.gt_u (i64.add (i64.extend_i32_u (local.get $arg1)) (i64.extend_i32_u (local.get $n))) (i64.const 4194304))) (then (call $glide_fail)))
    (i32.store offset=128 (call $glide_state) (local.get $arg1))(i32.store offset=148 (call $glide_state) (local.get $arg2))
    (i32.store offset=132 (call $glide_state) (i32.load offset=0 (local.get $q)))
    (i32.store offset=136 (call $glide_state) (i32.load offset=4 (local.get $q)))
    (i32.store offset=140 (call $glide_state) (i32.load offset=8 (local.get $q)))
    (i32.store offset=144 (call $glide_state) (i32.load offset=12 (local.get $q)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_grTexDownloadMipMap
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (local $q i32) (local $n i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (call $glide_copy_guest (call $glide_scratch) (local.get $arg3) (i32.const 20))
    (local.set $q (call $glide_scratch))
    (local.set $n (call $glide_tex_bytes (i32.load offset=0 (local.get $q)) (i32.load offset=4 (local.get $q)) (i32.load offset=8 (local.get $q)) (i32.load offset=12 (local.get $q)) (local.get $arg2)))
    (if (i32.or (i32.ne (i32.and (local.get $arg1) (i32.const 7)) (i32.const 0)) (i64.gt_u (i64.add (i64.extend_i32_u (local.get $arg1)) (i64.extend_i32_u (local.get $n))) (i64.const 4194304))) (then (call $glide_fail)))
    (local.set $p (call $glide_record (i32.const 6) (i32.add (local.get $n) (i32.const 28))))
    (i32.store offset=0 (local.get $p) (local.get $arg1))
    (i32.store offset=4 (local.get $p) (i32.load offset=0 (local.get $q)))
    (i32.store offset=8 (local.get $p) (i32.load offset=4 (local.get $q)))
    (i32.store offset=12 (local.get $p) (i32.load offset=8 (local.get $q)))
    (i32.store offset=16 (local.get $p) (i32.load offset=12 (local.get $q)))
    (i32.store offset=20 (local.get $p) (local.get $arg2))
    (i32.store offset=24 (local.get $p) (local.get $n))
    (call $glide_copy_guest (i32.add (local.get $p) (i32.const 28)) (i32.load offset=16 (local.get $q)) (local.get $n))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_grTexDownloadTable
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_tmu (local.get $arg0))
    (if (i32.ne (local.get $arg1) (i32.const 2)) (then (call $crash_unimplemented (local.get $name_ptr))))
    (local.set $p (call $glide_record (i32.const 7) (i32.const 1024)))
    (call $glide_copy_guest (local.get $p) (local.get $arg2) (i32.const 1024))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_grFogTable
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (local.set $p (call $glide_record (i32.const 8) (i32.const 64)))
    (call $glide_copy_guest (local.get $p) (local.get $arg0) (i32.const 64))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grDrawTriangle
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_check_guest (local.get $arg1) (i32.const 20))
    (call $glide_triangle (local.get $arg0) (local.get $arg1) (local.get $arg2))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_grBufferClear
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (call $lock_acquire (global.get $GLIDE_STATE))
    (local.set $p (call $glide_record (i32.const 3) (i32.const 268)))
    (memory.copy (local.get $p) (call $glide_state) (i32.const 256))
    (i32.store offset=256 (local.get $p) (local.get $arg0)) (i32.store offset=260 (local.get $p) (local.get $arg1)) (i32.store offset=264 (local.get $p) (local.get $arg2))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_grBufferSwap
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_flush)
    (if (i32.ne (call $host_glide_submit (i32.const 4) (call $glide_state) (i32.const 256)) (i32.const 1))
      (then (call $glide_fail)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_grLfbLock
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (local $q i32) (local $r i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (block $invalid
      (br_if $invalid (i32.load offset=48 (global.get $GLIDE_STATE)))
      (br_if $invalid (i32.gt_u (i32.and (local.get $arg0) (i32.const -17)) (i32.const 1)))
      (br_if $invalid (i32.and (i32.ne (local.get $arg2) (i32.const 0)) (i32.ne (local.get $arg2) (i32.const 255))))
      (if (local.get $arg4) (then (call $crash_unimplemented (local.get $name_ptr))))
      (local.set $q (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
      (br_if $invalid (i32.or (i32.eqz (local.get $q))
        (i32.gt_u (local.get $q) (i32.const 4294967275))))
      (br_if $invalid (i32.ne (call $gl32 (local.get $q)) (i32.const 20)))
      (local.set $p (call $glide_lfb_stage (local.get $arg1) (local.get $arg3)))
      (br_if $invalid (i32.eqz (local.get $p)))
      (call $gs32 (i32.add (local.get $q) (i32.const 4)) (i32.add (i32.load offset=40 (global.get $GLIDE_STATE)) (i32.const 20)))
      (call $gs32 (i32.add (local.get $q) (i32.const 8)) (i32.mul (i32.load offset=24 (global.get $GLIDE_STATE)) (i32.const 2)))
      (call $gs32 (i32.add (local.get $q) (i32.const 12)) (i32.const 0))
      (call $gs32 (i32.add (local.get $q) (i32.const 16)) (local.get $arg3))
      (i32.store offset=48 (global.get $GLIDE_STATE) (i32.add (i32.and (local.get $arg0) (i32.const 1)) (i32.const 1)))
      (i32.store offset=52 (global.get $GLIDE_STATE) (local.get $arg1))
      (local.set $r (i32.const 1)))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))

  (func $handle_grLfbUnlock
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $r i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (block $invalid
      (br_if $invalid (i32.ne (i32.load offset=48 (global.get $GLIDE_STATE)) (i32.add (i32.and (local.get $arg0) (i32.const 1)) (i32.const 1))))
      (br_if $invalid (i32.ne (i32.load offset=52 (global.get $GLIDE_STATE)) (local.get $arg1)))
      (local.set $r (i32.const 1))
      (if (i32.eq (i32.load offset=48 (global.get $GLIDE_STATE)) (i32.const 2)) (then
          (local.set $r (call $glide_lfb_publish (call $g2w (i32.load offset=40 (global.get $GLIDE_STATE)))))))
      (i32.store offset=48 (global.get $GLIDE_STATE) (i32.const 0)))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_grLfbReadRegion
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (local $q i32) (local $n i32) (local $r i32)
    (local $w i32) (local $h i32) (local $i i32) (local $j i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (block $invalid
      (br_if $invalid (i32.load offset=48 (global.get $GLIDE_STATE)))
      (local.set $w (local.get $arg3)) (local.set $h (local.get $arg4))
      (local.set $n (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)))) (local.set $q (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))
      (br_if $invalid (i32.eqz (local.get $q)))
      (br_if $invalid (i32.or (i32.eqz (local.get $w)) (i32.eqz (local.get $h))))
      (br_if $invalid (i64.gt_u (i64.add (i64.extend_i32_u (local.get $arg1)) (i64.extend_i32_u (local.get $w))) (i64.extend_i32_u (i32.load offset=24 (global.get $GLIDE_STATE)))))
      (br_if $invalid (i64.gt_u (i64.add (i64.extend_i32_u (local.get $arg2)) (i64.extend_i32_u (local.get $h))) (i64.extend_i32_u (i32.load offset=28 (global.get $GLIDE_STATE)))))
      (br_if $invalid (i32.lt_s (local.get $n) (i32.mul (local.get $w) (i32.const 2))))
      (br_if $invalid (i64.gt_u (i64.add (i64.extend_i32_u (local.get $q)) (i64.mul (i64.extend_i32_u (local.get $n)) (i64.extend_i32_u (local.get $h)))) (i64.const 4294967295)))
      (local.set $p (call $glide_lfb_stage (local.get $arg0) (i32.const 0)))
      (br_if $invalid (i32.eqz (local.get $p)))
      (local.set $p (i32.add (local.get $p) (i32.add (i32.const 20) (i32.mul (i32.add (i32.mul (local.get $arg2) (i32.load offset=24 (global.get $GLIDE_STATE))) (local.get $arg1)) (i32.const 2)))))
      (loop $rows
        (local.set $j (i32.const 0))
        (loop $pixels
          (call $gs8 (i32.add (local.get $q) (local.get $j)) (i32.load8_u (i32.add (local.get $p) (local.get $j))))
          (local.set $j (i32.add (local.get $j) (i32.const 1)))
          (br_if $pixels (i32.lt_u (local.get $j) (i32.mul (local.get $w) (i32.const 2)))))
        (local.set $p (i32.add (local.get $p) (i32.mul (i32.load offset=24 (global.get $GLIDE_STATE)) (i32.const 2))))
        (local.set $q (i32.add (local.get $q) (local.get $n)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $rows (i32.lt_u (local.get $i) (local.get $h))))
      (local.set $r (i32.const 1))
      )
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))

  (func $handle_grLfbWriteRegion
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $p i32) (local $q i32) (local $n i32) (local $r i32)
    (local $w i32) (local $h i32) (local $i i32) (local $j i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (block $invalid
      (br_if $invalid (i32.load offset=48 (global.get $GLIDE_STATE)))
      (local.set $w (local.get $arg4)) (local.set $h (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
      (local.set $n (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)))) (local.set $q (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))
      (br_if $invalid (i32.eqz (local.get $q)))
      (br_if $invalid (i32.or (i32.eqz (local.get $w)) (i32.eqz (local.get $h))))
      (br_if $invalid (i64.gt_u (i64.add (i64.extend_i32_u (local.get $arg1)) (i64.extend_i32_u (local.get $w))) (i64.extend_i32_u (i32.load offset=24 (global.get $GLIDE_STATE)))))
      (br_if $invalid (i64.gt_u (i64.add (i64.extend_i32_u (local.get $arg2)) (i64.extend_i32_u (local.get $h))) (i64.extend_i32_u (i32.load offset=28 (global.get $GLIDE_STATE)))))
      (br_if $invalid (i32.lt_s (local.get $n) (i32.mul (local.get $w) (i32.const 2))))
      (br_if $invalid (i64.gt_u (i64.add (i64.extend_i32_u (local.get $q)) (i64.mul (i64.extend_i32_u (local.get $n)) (i64.extend_i32_u (local.get $h)))) (i64.const 4294967295)))
      (if (i32.ne (local.get $arg3) (i32.const 0)) (then (call $crash_unimplemented (local.get $name_ptr))))
      (local.set $p (call $glide_lfb_stage (local.get $arg0) (i32.const 0)))
      (br_if $invalid (i32.eqz (local.get $p)))
      (local.set $p (i32.add (local.get $p) (i32.add (i32.const 20) (i32.mul (i32.add (i32.mul (local.get $arg2) (i32.load offset=24 (global.get $GLIDE_STATE))) (local.get $arg1)) (i32.const 2)))))
      (loop $rows
        (local.set $j (i32.const 0))
        (loop $pixels
          (i32.store8 (i32.add (local.get $p) (local.get $j)) (call $gl8 (i32.add (local.get $q) (local.get $j))))
          (local.set $j (i32.add (local.get $j) (i32.const 1)))
          (br_if $pixels (i32.lt_u (local.get $j) (i32.mul (local.get $w) (i32.const 2)))))
        (local.set $p (i32.add (local.get $p) (i32.mul (i32.load offset=24 (global.get $GLIDE_STATE)) (i32.const 2))))
        (local.set $q (i32.add (local.get $q) (local.get $n)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $rows (i32.lt_u (local.get $i) (local.get $h))))
      (local.set $r (i32.const 1))
      (local.set $r (call $glide_lfb_publish (call $g2w (i32.load offset=40 (global.get $GLIDE_STATE)))))
      )
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36))))

  (func $handle_grAADrawLine
    (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
    (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $host_log_i32 (i32.const 0x474c4944))
    (call $crash_unimplemented (local.get $name_ptr)))

  (func $handle_grDrawLine
      (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
      (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_small_primitive (i32.const 11) (local.get $arg0) (local.get $arg1))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_grDrawPoint
      (param $arg0 i32) (param $arg1 i32) (param $arg2 i32)
      (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $lock_acquire (global.get $GLIDE_STATE))
    (call $glide_small_primitive (i32.const 12) (local.get $arg0) (i32.const 0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $lock_release (global.get $GLIDE_STATE))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))
