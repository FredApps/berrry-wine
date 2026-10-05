;; PRIVATE draft: path_wa is an owned contiguous NUL-terminated UTF16 path.
  (func $vbdd_load_bmp24_wide (param $path_wa i32) (result i32)
    (local $handle i32) (local $size i32) (local $buf_ga i32) (local $buf_wa i32)
    (local $read_ga i32) (local $read_wa i32) (local $off i32) (local $hdr i32) (local $bmp i32) (local $width i32) (local $height i32) (local $extent i64)
    (local.set $handle (call $host_fs_create_file
      (local.get $path_wa) (i32.const 0x80000000)
      (i32.const 3) (i32.const 0x80) (i32.const 1)))
    (if (i32.eq (local.get $handle) (i32.const -1)) (then (return (i32.const 0))))
    (local.set $size (call $host_fs_get_file_size (local.get $handle)))
    ;; 54 = BITMAPFILEHEADER + BITMAPINFOHEADER, the smallest legal BMP.
    (if (i32.or (i32.lt_u (local.get $size) (i32.const 54))
                (i32.gt_u (local.get $size) (i32.const 0x2000000)))
      (then
        (drop (call $host_fs_close_handle (local.get $handle)))
        (return (i32.const 0))))
    (local.set $buf_ga (call $heap_alloc (local.get $size)))
    (local.set $read_ga (call $heap_alloc (i32.const 4)))
    (if (i32.or (i32.eqz (local.get $buf_ga)) (i32.eqz (local.get $read_ga)))
      (then
        (drop (call $host_fs_close_handle (local.get $handle)))
        (if (local.get $buf_ga) (then (call $heap_free (local.get $buf_ga))))
        (if (local.get $read_ga) (then (call $heap_free (local.get $read_ga))))
        (return (i32.const 0))))
    (local.set $read_wa (call $g2w (local.get $read_ga))) (i32.store (local.get $read_wa) (i32.const 0))
    (drop (call $host_fs_read_file
      (local.get $handle) (local.get $buf_ga) (local.get $size) (local.get $read_ga)))
    (drop (call $host_fs_close_handle (local.get $handle)))
    (local.set $size (i32.load (local.get $read_wa)))
    (call $heap_free (local.get $read_ga))
    (local.set $buf_wa (call $g2w (local.get $buf_ga)))
    ;; 0x4D42 = 'BM'
    (if (i32.or (i32.lt_u (local.get $size) (i32.const 54))
                (i32.ne (i32.load16_u (local.get $buf_wa)) (i32.const 0x4D42)))
      (then
        (call $heap_free (local.get $buf_ga))
        (return (i32.const 0))))
    (local.set $hdr (i32.add (local.get $buf_wa) (i32.const 14)))
    (local.set $off (i32.load offset=10 (local.get $buf_wa)))  ;; bfOffBits

    ;; Intentionally bounded BI_RGB 24bpp BITMAPINFOHEADER subset. Reject
    ;; unsupported compression/headers and truncated rows before GDI reads.
    (local.set $width (i32.load offset=4 (local.get $hdr)))
    (local.set $height (i32.load offset=8 (local.get $hdr)))
    (if (i32.lt_s (local.get $height) (i32.const 0))
      (then (local.set $height (i32.sub (i32.const 0) (local.get $height)))))
    (if (i32.or
      (i32.or (i32.ne (i32.load (local.get $hdr)) (i32.const 40))
        (i32.ne (i32.load offset=16 (local.get $hdr)) (i32.const 0)))
      (i32.or (i32.ne (i32.load16_u offset=12 (local.get $hdr)) (i32.const 1))
        (i32.ne (i32.load16_u offset=14 (local.get $hdr)) (i32.const 24))))
      (then (call $heap_free (local.get $buf_ga)) (return (i32.const 0))))
    (if (i32.or
      (i32.or (i32.le_s (local.get $width) (i32.const 0)) (i32.gt_u (local.get $width) (i32.const 4096)))
      (i32.or (i32.le_s (local.get $height) (i32.const 0)) (i32.gt_u (local.get $height) (i32.const 4096))))
      (then (call $heap_free (local.get $buf_ga)) (return (i32.const 0))))
    (local.set $extent (i64.add (i64.extend_i32_u (local.get $off))
      (i64.mul (i64.extend_i32_u (i32.and (i32.add (i32.mul (local.get $width) (i32.const 3)) (i32.const 3)) (i32.const -4)))
        (i64.extend_i32_u (local.get $height)))))
    (if (i32.or (i32.lt_u (local.get $off) (i32.const 54))
      (i64.gt_u (local.get $extent) (i64.extend_i32_u (local.get $size))))
      (then (call $heap_free (local.get $buf_ga)) (return (i32.const 0))))
    (if (i32.const 1)
      (then
        (if (call $gdi_bitmap_plan_info (local.get $hdr) (global.get $GDI_BITMAP_PLAN))
          (then (local.set $bmp (call $gdi_bitmap_create_owned
            (global.get $GDI_BITMAP_PLAN)
            (i32.add (local.get $buf_wa) (local.get $off))
            (i32.const 1) (i32.const 1) (i32.const 1)
            (i32.const 0) (i32.const 0))))))
      (else
        (local.set $bmp (call $gdi_bitmap_create_dibitmap
          (i32.const 0) (local.get $hdr)
          (i32.add (local.get $buf_wa) (local.get $off))
          (i32.const 1) (i32.const 0)))))
    (call $heap_free (local.get $buf_ga))
    (local.get $bmp))
