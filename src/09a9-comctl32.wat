  ;; ============================================================
  ;; COMCTL32 HANDLERS
  ;; ImageList, toolbar and status-bar creation, up-down and property sheets,
  ;; MenuHelp, and the DSA/DPA dynamic-array and pointer-array APIs.
  ;; 
  ;; This was a 680-line slab of comctl32 sitting in the middle of
  ;; 09a-handlers.wat, the file for everything that had nowhere else to go.
  ;; ============================================================

  ;; SHGetFileInfo returns one small and one large system image list for the
  ;; lifetime of a process.  Keep those handles in shared memory: mutable WAT
  ;; globals are instance-local, while guest threads can execute APIs through
  ;; separate Worker instances over the same linear memory.
  (global $SHELL_FILE_INFO i32 (region.addr $SHELL_FILE_INFO 0))
  (global $SHELL_FILE_INFO_SIZE i32 (region.size $SHELL_FILE_INFO))
  (data (region.addr $SHELL_FILE_INFO 0x20)
    "File\00File Folder\00Application\00Local Disk\00Desktop\00My Computer\00Network Neighborhood\00")

  ;; Paint one scaled rectangle into a five-image, 32-bpp top-down strip.
  ;; Coordinates are expressed in a 16x16 design grid so the same classic
  ;; glyphs remain crisp in both system image lists.
  (func $shell_icon_rect
      (param $bits i32) (param $stride i32) (param $size i32) (param $index i32)
      (param $left i32) (param $top i32) (param $right i32) (param $bottom i32)
      (param $color i32)
    (local $x0 i32) (local $x1 i32) (local $y0 i32) (local $y1 i32)
    (local $x i32) (local $y i32) (local $row i32)
    (local.set $x0 (i32.add (i32.mul (local.get $index) (local.get $size))
      (i32.div_u (i32.mul (local.get $left) (local.get $size)) (i32.const 16))))
    (local.set $x1 (i32.add (i32.mul (local.get $index) (local.get $size))
      (i32.div_u (i32.mul (local.get $right) (local.get $size)) (i32.const 16))))
    (local.set $y0
      (i32.div_u (i32.mul (local.get $top) (local.get $size)) (i32.const 16)))
    (local.set $y1
      (i32.div_u (i32.mul (local.get $bottom) (local.get $size)) (i32.const 16)))
    (local.set $y (local.get $y0))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_u (local.get $y) (local.get $y1)))
      (local.set $row (i32.add (local.get $bits)
        (i32.mul (local.get $y) (local.get $stride))))
      (local.set $x (local.get $x0))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_u (local.get $x) (local.get $x1)))
        (i32.store (i32.add (local.get $row) (i32.shl (local.get $x) (i32.const 2)))
          (local.get $color))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $cols)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $rows))))

  (func $shell_draw_system_icons (param $bits i32) (param $stride i32) (param $size i32)
    (local $i i32)
    ;; Transparent mask colour, one complete cell at a time.
    (block $background_done (loop $background
      (br_if $background_done (i32.ge_u (local.get $i) (i32.const 5)))
      (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
        (local.get $i) (i32.const 0) (i32.const 0) (i32.const 16) (i32.const 16)
        (i32.const 0x00FF00FF))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $background)))

    ;; 2: generic document, with the folded upper-right corner.
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 2) (i32.const 3) (i32.const 1) (i32.const 13) (i32.const 15) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 2) (i32.const 4) (i32.const 2) (i32.const 12) (i32.const 14) (i32.const 0x00FFFFFF))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 2) (i32.const 9) (i32.const 2) (i32.const 12) (i32.const 6) (i32.const 0x00C0C0C0))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 2) (i32.const 5) (i32.const 9) (i32.const 11) (i32.const 10) (i32.const 0x00808080))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 2) (i32.const 5) (i32.const 11) (i32.const 10) (i32.const 12) (i32.const 0x00808080))

    ;; 1: closed folder.
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 1) (i32.const 1) (i32.const 4) (i32.const 15) (i32.const 14) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 1) (i32.const 2) (i32.const 5) (i32.const 14) (i32.const 13) (i32.const 0x00F0C040))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 1) (i32.const 2) (i32.const 2) (i32.const 8) (i32.const 6) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 1) (i32.const 3) (i32.const 3) (i32.const 7) (i32.const 6) (i32.const 0x00FFFF80))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 1) (i32.const 3) (i32.const 6) (i32.const 13) (i32.const 7) (i32.const 0x00FFFF80))

    ;; 0: open folder; the stepped front lip distinguishes SHGFI_OPENICON.
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 0) (i32.const 1) (i32.const 4) (i32.const 13) (i32.const 13) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 0) (i32.const 2) (i32.const 5) (i32.const 12) (i32.const 12) (i32.const 0x00F0C040))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 0) (i32.const 2) (i32.const 2) (i32.const 8) (i32.const 6) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 0) (i32.const 3) (i32.const 3) (i32.const 7) (i32.const 6) (i32.const 0x00FFFF80))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 0) (i32.const 3) (i32.const 7) (i32.const 15) (i32.const 14) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 0) (i32.const 4) (i32.const 8) (i32.const 14) (i32.const 13) (i32.const 0x00FFFF80))

    ;; 3: application window.
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 3) (i32.const 1) (i32.const 2) (i32.const 15) (i32.const 14) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 3) (i32.const 2) (i32.const 3) (i32.const 14) (i32.const 13) (i32.const 0x00C0C0C0))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 3) (i32.const 3) (i32.const 4) (i32.const 13) (i32.const 7) (i32.const 0x000080C0))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 3) (i32.const 3) (i32.const 8) (i32.const 13) (i32.const 12) (i32.const 0x00FFFFFF))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 3) (i32.const 4) (i32.const 9) (i32.const 7) (i32.const 11) (i32.const 0x00008080))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 3) (i32.const 8) (i32.const 9) (i32.const 12) (i32.const 10) (i32.const 0x00808080))

    ;; 4: local drive.
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 4) (i32.const 1) (i32.const 5) (i32.const 15) (i32.const 13) (i32.const 0x00000000))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 4) (i32.const 2) (i32.const 6) (i32.const 14) (i32.const 12) (i32.const 0x00C0C0C0))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 4) (i32.const 3) (i32.const 6) (i32.const 13) (i32.const 8) (i32.const 0x00FFFFFF))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 4) (i32.const 2) (i32.const 10) (i32.const 14) (i32.const 12) (i32.const 0x00808080))
    (call $shell_icon_rect (local.get $bits) (local.get $stride) (local.get $size)
      (i32.const 4) (i32.const 11) (i32.const 10) (i32.const 13) (i32.const 11) (i32.const 0x0000C000)))

  ;; Return the per-process system image list for one icon size.  Construction
  ;; happens without a lock because bitmap registration calls the host.  A CAS
  ;; publishes the completed object; a rare racing loser tears its candidate
  ;; down instead of exposing a half-initialized shared object or deadlocking a
  ;; browser main thread against a Worker RPC.
  (func $shell_system_image_list (param $size i32) (result i32)
    (local $slot i32) (local $existing i32) (local $candidate i32)
    (local $candidate_wa i32) (local $bits_guest i32) (local $bits i32)
    (local $width i32) (local $stride i32) (local $bitmap i32)
    (local.set $slot (i32.add (global.get $SHELL_FILE_INFO)
      (select (i32.const 0) (i32.const 4) (i32.eq (local.get $size) (i32.const 16)))))
    (local.set $existing (i32.atomic.load (local.get $slot)))
    (if (local.get $existing) (then (return (local.get $existing))))
    (local.set $width (i32.mul (local.get $size) (i32.const 5)))
    (local.set $stride (i32.shl (local.get $width) (i32.const 2)))
    (local.set $bits_guest
      (call $dib_alloc (i32.mul (local.get $stride) (local.get $size))))
    (if (i32.eqz (local.get $bits_guest)) (then (return (i32.const 0))))
    (local.set $bits (call $g2w (local.get $bits_guest)))
    (call $shell_draw_system_icons
      (local.get $bits) (local.get $stride) (local.get $size))
    (local.set $bitmap (call $gdi_bitmap_alloc
      (local.get $width) (local.get $size) (i32.const 32) (i32.const 6)
      (local.get $bits) (local.get $stride) (i32.const 0) (i32.const 0)))
    (if (i32.eqz (local.get $bitmap))
      (then
        (call $dib_free_wasm (local.get $bits))
        (return (i32.const 0))))
    (local.set $candidate (call $heap_alloc (i32.const 36)))
    (if (i32.eqz (local.get $candidate))
      (then
        (drop (call $gdi_object_delete_full (local.get $bitmap)))
        (return (i32.const 0))))
    (local.set $candidate_wa (call $g2w (local.get $candidate)))
    (call $zero_memory (local.get $candidate_wa) (i32.const 36))
    (i32.store          (local.get $candidate_wa) (local.get $size))
    (i32.store offset=4 (local.get $candidate_wa) (local.get $size))
    (i32.store offset=8 (local.get $candidate_wa) (i32.const -1)) ;; CLR_NONE
    (i32.store offset=12 (local.get $candidate_wa) (i32.const 5))
    (i32.store offset=16 (local.get $candidate_wa) (local.get $bitmap))
    (i32.store offset=20 (local.get $candidate_wa) (i32.const 0x00FF00FF))
    (i32.store offset=32 (local.get $candidate_wa) (i32.const 0x4C4D4948)) ;; HIML
    (local.set $existing
      (i32.atomic.rmw.cmpxchg (local.get $slot) (i32.const 0) (local.get $candidate)))
    (if (local.get $existing)
      (then
        (drop (call $gdi_object_delete_full (local.get $bitmap)))
        (call $heap_free (local.get $candidate))
        (return (local.get $existing))))
    (local.get $candidate))

  ;; Create the independent HICON promised by ImageList_GetIcon. An entry
  ;; retained by ImageList_ReplaceIcon is copied through USER's normal icon
  ;; ownership path. A bitmap-strip entry is materialized into owned colour
  ;; and 1-bpp AND-mask planes, so arbitrary image-list mask colours remain
  ;; correct after the source list is changed or destroyed.
  (func $image_list_icon_handle (param $list i32) (param $index i32) (result i32)
    (local $sw i32) (local $cx i32) (local $cy i32) (local $icons i32)
    (local $retained i32) (local $source_bitmap i32) (local $mask_key i32)
    (local $source i32) (local $color_desc i32) (local $mask_desc i32)
    (local $color i32) (local $mask i32) (local $mask_stride i32)
    (local $x i32) (local $y i32) (local $pixel i32) (local $result i32)
    (if (i32.eqz (local.get $list)) (then (return (i32.const 0))))
    (local.set $sw (call $g2w (local.get $list)))
    (if (i32.or
          (i32.ne (i32.load offset=32 (local.get $sw)) (i32.const 0x4C4D4948))
          (i32.ge_u (local.get $index) (i32.load offset=12 (local.get $sw))))
      (then (return (i32.const 0))))
    (local.set $cx (i32.load (local.get $sw)))
    (local.set $cy (i32.load offset=4 (local.get $sw)))
    (if (i32.or
          (i32.or (i32.le_s (local.get $cx) (i32.const 0))
            (i32.gt_s (local.get $cx) (i32.const 256)))
          (i32.or (i32.le_s (local.get $cy) (i32.const 0))
            (i32.gt_s (local.get $cy) (i32.const 256))))
      (then (return (i32.const 0))))
    (local.set $icons (i32.load offset=24 (local.get $sw)))
    (if (i32.and (i32.ne (local.get $icons) (i32.const 0))
          (i32.lt_u (local.get $index) (i32.load offset=28 (local.get $sw))))
      (then
        (local.set $retained (i32.load (call $g2w (i32.add (local.get $icons)
          (i32.shl (local.get $index) (i32.const 2))))))
        (if (local.get $retained)
          (then (return (call $icon_copy_handle (local.get $retained)))))))
    (local.set $source_bitmap (i32.load offset=16 (local.get $sw)))
    (if (i32.or (i32.eqz (local.get $source_bitmap))
          (i32.or
            (i32.lt_s (call $host_gdi_get_object_w (local.get $source_bitmap))
              (i32.mul (i32.add (local.get $index) (i32.const 1)) (local.get $cx)))
            (i32.lt_s (call $host_gdi_get_object_h (local.get $source_bitmap))
              (local.get $cy))))
      (then (return (i32.const 0))))

    ;; Owned 32-bpp colour plane.
    (memory.fill (global.get $GDI_BITMAP_PLAN) (i32.const 0) (i32.const 48))
    (i32.store          (global.get $GDI_BITMAP_PLAN) (local.get $cx))
    (i32.store offset=4 (global.get $GDI_BITMAP_PLAN) (local.get $cy))
    (i32.store offset=8 (global.get $GDI_BITMAP_PLAN) (i32.const 32))
    (i32.store offset=12 (global.get $GDI_BITMAP_PLAN) (i32.const 2)) ;; top-down
    (i32.store offset=16 (global.get $GDI_BITMAP_PLAN)
      (i32.shl (local.get $cx) (i32.const 2)))
    (i32.store offset=32 (global.get $GDI_BITMAP_PLAN)
      (i32.shl (i32.mul (local.get $cx) (local.get $cy)) (i32.const 2)))
    (local.set $color (call $gdi_bitmap_create_owned
      (global.get $GDI_BITMAP_PLAN) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0)))
    (if (i32.eqz (local.get $color)) (then (return (i32.const 0))))

    ;; Owned 1-bpp AND mask. Its rows are DWORD-aligned like a Win32 DDB.
    (local.set $mask_stride (i32.shl
      (i32.shr_u (i32.add (local.get $cx) (i32.const 31)) (i32.const 5))
      (i32.const 2)))
    (memory.fill (global.get $GDI_BITMAP_PLAN) (i32.const 0) (i32.const 48))
    (i32.store          (global.get $GDI_BITMAP_PLAN) (local.get $cx))
    (i32.store offset=4 (global.get $GDI_BITMAP_PLAN) (local.get $cy))
    (i32.store offset=8 (global.get $GDI_BITMAP_PLAN) (i32.const 1))
    (i32.store offset=12 (global.get $GDI_BITMAP_PLAN) (i32.const 2)) ;; top-down
    (i32.store offset=16 (global.get $GDI_BITMAP_PLAN) (local.get $mask_stride))
    (i32.store offset=32 (global.get $GDI_BITMAP_PLAN)
      (i32.mul (local.get $mask_stride) (local.get $cy)))
    (local.set $mask (call $gdi_bitmap_create_owned
      (global.get $GDI_BITMAP_PLAN) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0)))
    (if (i32.eqz (local.get $mask))
      (then
        (drop (call $gdi_object_delete_full (local.get $color)))
        (return (i32.const 0))))
    (local.set $source (global.get $GDI_BLIT_SRC_DESC))
    (local.set $color_desc (global.get $CURSOR_COLOR_DESC))
    (local.set $mask_desc (global.get $CURSOR_MASK_DESC))
    (if (i32.or
          (i32.eqz (call $gdi_raster_desc_from_bitmap
            (local.get $source_bitmap) (local.get $source)))
          (i32.or
            (i32.eqz (call $gdi_raster_desc_from_bitmap
              (local.get $color) (local.get $color_desc)))
            (i32.eqz (call $gdi_raster_desc_from_bitmap
              (local.get $mask) (local.get $mask_desc)))))
      (then
        (drop (call $gdi_object_delete_full (local.get $mask)))
        (drop (call $gdi_object_delete_full (local.get $color)))
        (return (i32.const 0))))
    (local.set $mask_key (i32.load offset=20 (local.get $sw)))
    ;; CLR_DEFAULT asks common controls to derive transparency from the
    ;; bitmap's upper-left pixel.  gdi_raster_read already returns the
    ;; canonical channel order; an explicit COLORREF still needs conversion.
    (if (i32.eq (local.get $mask_key) (i32.const 0xFF000000))
      (then
        (local.set $mask_key (call $gdi_raster_read (local.get $source)
          (i32.const 0) (i32.const 0))))
      (else
        (if (i32.ne (local.get $mask_key) (i32.const -1))
          (then (local.set $mask_key
            (call $gdi_raster_swap_rb (local.get $mask_key)))))))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_u (local.get $y) (local.get $cy)))
      (local.set $x (i32.const 0))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_u (local.get $x) (local.get $cx)))
        (local.set $pixel (call $gdi_raster_read (local.get $source)
          (i32.add (i32.mul (local.get $index) (local.get $cx)) (local.get $x))
          (local.get $y)))
        (if (i32.eq (local.get $pixel) (i32.const -1))
          (then
            (drop (call $gdi_object_delete_full (local.get $mask)))
            (drop (call $gdi_object_delete_full (local.get $color)))
            (return (i32.const 0))))
        (drop (call $gdi_raster_write (local.get $color_desc)
          (local.get $x) (local.get $y) (local.get $pixel)))
        (drop (call $gdi_raster_write_index (local.get $mask_desc)
          (local.get $x) (local.get $y)
          (i32.and (i32.ne (local.get $mask_key) (i32.const -1))
            (i32.eq (local.get $pixel) (local.get $mask_key)))))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $cols)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $rows)))
    (local.set $result (call $cursor_intern (i32.const 1)
      (i32.shr_u (local.get $cx) (i32.const 1))
      (i32.shr_u (local.get $cy) (i32.const 1))
      (local.get $mask) (local.get $color)))
    (if (i32.eqz (local.get $result))
      (then
        (drop (call $gdi_object_delete_full (local.get $mask)))
        (drop (call $gdi_object_delete_full (local.get $color)))))
    (local.get $result))

  ;; Release an image-list's private HICON array.  The bitmap strip at +16 is
  ;; deliberately not touched: resource-loaded strips are owned by GDI, while
  ;; ImageList_AddMasked copies caller pixels into this private icon array.
  (func $image_list_destroy_icon_array (param $icons i32) (param $count i32)
    (local $icons_wa i32) (local $i i32) (local $icon i32)
    (if (local.get $icons)
      (then
        (local.set $icons_wa (call $g2w (local.get $icons)))
        (block $done (loop $entries
          (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
          (local.set $icon (i32.load (i32.add (local.get $icons_wa)
            (i32.shl (local.get $i) (i32.const 2)))))
          (if (local.get $icon)
            (then (drop (call $icon_destroy_handle (local.get $icon)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $entries)))
        (call $heap_free (local.get $icons)))))

  ;; InitCommonControls() — 0 args, void return, registers common control window classes
  (func $handle_InitCommonControls (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; No-op: our window creation handles class names directly
    (global.set $esp (i32.add (global.get $esp) (i32.const 4)))
  )

  ;; ImageList_Create(cx, cy, flags, cInitial, cGrow) — 5 args, returns HIMAGELIST handle
  (func $handle_ImageList_Create (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $buf i32) (local $buf_wa i32)
    ;; ImageList struct:
    ;; +0 cx, +4 cy, +8 bk color, +12 count, +16 bitmap strip, +20 mask color,
    ;; +24 icon-handle array, +28 icon-array capacity, +32 validity tag.
    (local.set $buf (call $heap_alloc (i32.const 36)))
    (local.set $buf_wa (call $g2w (local.get $buf)))
    (call $zero_memory (local.get $buf_wa) (i32.const 36))
    (i32.store (local.get $buf_wa) (local.get $arg0))           ;; cx
    (i32.store offset=4 (local.get $buf_wa) (local.get $arg1))  ;; cy
    (i32.store offset=8 (local.get $buf_wa) (i32.const -1))     ;; CLR_NONE
    (i32.store offset=12 (local.get $buf_wa) (i32.const 0))     ;; count=0
    (i32.store offset=32 (local.get $buf_wa) (i32.const 0x4c4d4948)) ;; "HIML"
    (global.set $eax (local.get $buf))
    (global.set $esp (i32.add (global.get $esp) (i32.const 24)))  ;; stdcall, 5 args
  )

  ;; ImageList_Destroy(himl) — 1 arg, returns BOOL
  (func $handle_ImageList_Destroy (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $sw i32) (local $icons i32) (local $count i32) (local $bitmap i32)
    (global.set $eax (i32.const 0))
    ;; The lists returned by SHGFI_SYSICONINDEX are shared system resources;
    ;; applications must not destroy them.  Refuse the operation so the stable
    ;; process handles never point at reclaimed heap blocks.
    (if (i32.and (i32.ne (local.get $arg0) (i32.const 0))
          (i32.or
            (i32.eq (local.get $arg0)
              (i32.atomic.load (global.get $SHELL_FILE_INFO)))
            (i32.eq (local.get $arg0)
              (i32.atomic.load offset=4 (global.get $SHELL_FILE_INFO)))))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (if (local.get $arg0)
      (then
        (local.set $sw (call $g2w (local.get $arg0)))
        (if (i32.eq (i32.load offset=32 (local.get $sw)) (i32.const 0x4c4d4948))
          (then
            ;; Invalidate before returning either block to the allocator so a
            ;; duplicate destroy cannot link the same block into the free list.
            (i32.store offset=32 (local.get $sw) (i32.const 0))
            (local.set $icons (i32.load offset=24 (local.get $sw)))
            (i32.store offset=24 (local.get $sw) (i32.const 0))
            (if (local.get $icons)
              (then
                (local.set $count (i32.load offset=12 (local.get $sw)))
                (call $image_list_destroy_icon_array
                  (local.get $icons) (local.get $count))))
            ;; ImageList_LoadImage owns the bitmap strip it loaded. Lists that
            ;; have converted their cells to retained icons clear this field,
            ;; so the two representations cannot release the same pixels.
            (local.set $bitmap (i32.load offset=16 (local.get $sw)))
            (i32.store offset=16 (local.get $sw) (i32.const 0))
            (if (local.get $bitmap)
              (then (drop (call $gdi_object_delete_full (local.get $bitmap)))))
            (call $heap_free (local.get $arg0))
            (global.set $eax (i32.const 1))))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; ImageList_LoadImageA/W share all behavior except the width of lpbmp.
  ;; uType must be IMAGE_BITMAP. uFlags lives beyond the dispatcher's five
  ;; register-like arguments and is supplied explicitly by the two wrappers.
  (func $image_list_load_image
      (param $hi i32) (param $name i32) (param $cx_arg i32)
      (param $c_grow i32) (param $mask_color i32) (param $image_type i32)
      (param $load_flags i32) (param $wide i32) (result i32)
    (local $buf i32) (local $buf_wa i32) (local $cx i32)
    (local $bmp i32) (local $bmp_w i32) (local $bmp_h i32)
    (local $count i32) (local $path i32) (local $path_owned i32)
    (drop (local.get $c_grow))
    ;; The common-controls contract is bitmap-only. Icons and cursors belong
    ;; to LoadImage; accepting them here creates a list with invalid geometry.
    (if (i32.ne (local.get $image_type) (i32.const 0))
      (then (return (i32.const 0))))
    (if (i32.ne
          (i32.and (local.get $load_flags) (i32.const 0x10)) ;; LR_LOADFROMFILE
          (i32.const 0))
      (then
        ;; A file load requires a string, never MAKEINTRESOURCE. Convert W
        ;; paths through a call-owned buffer before entering the VFS, whose
        ;; Win9x paths are represented as ANSI; a shared scratch path would let
        ;; two guest threads corrupt one another's filename.
        (if (i32.le_u (local.get $name) (i32.const 0xFFFF))
          (then (return (i32.const 0))))
        (local.set $path (local.get $name))
        (if (local.get $wide)
          (then
            (if (i32.ge_u (call $guest_wcslen (local.get $name)) (i32.const 260))
              (then (return (i32.const 0))))
            (local.set $path_owned (call $heap_alloc (i32.const 260)))
            (if (i32.eqz (local.get $path_owned))
              (then (return (i32.const 0))))
            (drop (call $wide_to_ansi
              (local.get $name) (local.get $path_owned) (i32.const 260)))
            (local.set $path (local.get $path_owned))))
        (local.set $bmp (call $load_image_bitmap_file (call $g2w (local.get $path))))
        (if (local.get $path_owned)
          (then (call $heap_free (local.get $path_owned)))))
      (else
        (local.set $bmp (call $gdi_bitmap_load_resource
          (local.get $hi) (local.get $name) (local.get $wide)))))
    ;; ImageList_LoadImage returns NULL when LoadImage cannot resolve a real
    ;; bitmap. A fabricated empty HIMAGELIST hides missing resources and leaves
    ;; callers believing image index zero exists.
    (if (i32.eqz (local.get $bmp)) (then (return (i32.const 0))))
    (local.set $bmp_w (call $host_gdi_get_object_w (local.get $bmp)))
    (local.set $bmp_h (call $host_gdi_get_object_h (local.get $bmp)))
    (if (i32.or
          (i32.le_s (local.get $bmp_w) (i32.const 0))
          (i32.or (i32.le_s (local.get $bmp_h) (i32.const 0))
            (i32.lt_s (local.get $cx_arg) (i32.const 0))))
      (then
        (drop (call $gdi_object_delete_full (local.get $bmp)))
        (return (i32.const 0))))
    (local.set $cx (local.get $cx_arg))
    ;; With no cell width, the complete bitmap is one image. Never invent a
    ;; 16px width: the resource dimensions are the contract's source of truth.
    (if (i32.eqz (local.get $cx))
      (then (local.set $cx (local.get $bmp_w))))
    (local.set $count (i32.div_u (local.get $bmp_w) (local.get $cx)))
    (if (i32.eqz (local.get $count)) (then (local.set $count (i32.const 1))))
    (local.set $buf (call $heap_alloc (i32.const 36)))
    (if (i32.eqz (local.get $buf))
      (then
        (drop (call $gdi_object_delete_full (local.get $bmp)))
        (return (i32.const 0))))
    (local.set $buf_wa (call $g2w (local.get $buf)))
    (call $zero_memory (local.get $buf_wa) (i32.const 36))
    (i32.store (local.get $buf_wa) (local.get $cx))
    (i32.store offset=4 (local.get $buf_wa) (local.get $bmp_h))
    (i32.store offset=8 (local.get $buf_wa) (i32.const -1)) ;; CLR_NONE
    (i32.store offset=12 (local.get $buf_wa) (local.get $count))
    (i32.store offset=16 (local.get $buf_wa) (local.get $bmp))
    (i32.store offset=20 (local.get $buf_wa) (local.get $mask_color))
    (i32.store offset=32 (local.get $buf_wa) (i32.const 0x4c4d4948))
    (local.get $buf))

  ;; ImageList_LoadImageA(hi, lpbmp, cx, cGrow, crMask, uType, uFlags) — 7 args
  (func $handle_ImageList_LoadImageA (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (global.set $eax (call $image_list_load_image
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4)
      (call $gl32 (i32.add (global.get $esp) (i32.const 24)))
      (call $gl32 (i32.add (global.get $esp) (i32.const 28)))
      (i32.const 0)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 32)))
  )

  ;; ImageList_LoadImageW — same core with a UTF-16 resource/path name.
  (func $handle_ImageList_LoadImageW (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (global.set $eax (call $image_list_load_image
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4)
      (call $gl32 (i32.add (global.get $esp) (i32.const 24)))
      (call $gl32 (i32.add (global.get $esp) (i32.const 28)))
      (i32.const 1)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 32)))
  )

  ;; ImageList_AddMasked(himl, hbmImage, crMask) — 3 args, returns image index
  (func $handle_ImageList_AddMasked (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $count i32) (local $cx i32) (local $cy i32)
    (local $bmp_w i32) (local $bmp_h i32) (local $add_count i32)
    (local $new_count i32) (local $capacity i32) (local $sw i32)
    (local $old_icons i32) (local $new_icons i32) (local $new_icons_wa i32)
    (local $probe i32) (local $probe_wa i32)
    (local $i i32) (local $icon i32)
    (global.set $eax (i32.const -1))
    (if (i32.or (i32.eqz (local.get $arg0)) (i32.eqz (local.get $arg1)))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $sw (call $g2w (local.get $arg0)))
    (if (i32.ne (i32.load offset=32 (local.get $sw)) (i32.const 0x4C4D4948))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $count (i32.load offset=12 (local.get $sw)))
    (local.set $cx (i32.load (local.get $sw)))
    (local.set $cy (i32.load offset=4 (local.get $sw)))
    (local.set $bmp_w (call $host_gdi_get_object_w (local.get $arg1)))
    (local.set $bmp_h (call $host_gdi_get_object_h (local.get $arg1)))
    (if (i32.or
          (i32.or (i32.le_s (local.get $cx) (i32.const 0))
            (i32.le_s (local.get $cy) (i32.const 0)))
          (i32.or (i32.lt_s (local.get $bmp_w) (local.get $cx))
            (i32.lt_s (local.get $bmp_h) (local.get $cy))))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $add_count (i32.div_u (local.get $bmp_w) (local.get $cx)))
    (local.set $new_count (i32.add (local.get $count) (local.get $add_count)))
    (if (i32.or (i32.lt_u (local.get $new_count) (local.get $count))
          (i32.gt_u (local.get $new_count) (i32.const 0x10000)))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))

    ;; Build the complete replacement array before touching the live list.
    ;; This gives ImageList_AddMasked its documented copy semantics: the
    ;; caller may DeleteObject(hbmImage) immediately after this function.
    (local.set $capacity (i32.const 4))
    (block $capacity_ready (loop $grow_capacity
      (br_if $capacity_ready
        (i32.ge_u (local.get $capacity) (local.get $new_count)))
      (local.set $capacity (i32.shl (local.get $capacity) (i32.const 1)))
      (br $grow_capacity)))
    (local.set $new_icons
      (call $heap_alloc (i32.shl (local.get $capacity) (i32.const 2))))
    (if (i32.eqz (local.get $new_icons))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $new_icons_wa (call $g2w (local.get $new_icons)))
    (call $zero_memory (local.get $new_icons_wa)
      (i32.shl (local.get $capacity) (i32.const 2)))

    ;; Preserve every existing entry, whether it is already an owned HICON or
    ;; still backed by a resource-loaded bitmap strip.
    (block $old_done (loop $old_entries
      (br_if $old_done (i32.ge_u (local.get $i) (local.get $count)))
      (local.set $icon
        (call $image_list_icon_handle (local.get $arg0) (local.get $i)))
      (if (i32.eqz (local.get $icon))
        (then
          (call $image_list_destroy_icon_array
            (local.get $new_icons) (local.get $i))
          (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
          (return)))
      (i32.store (i32.add (local.get $new_icons_wa)
        (i32.shl (local.get $i) (i32.const 2))) (local.get $icon))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $old_entries)))

    ;; A small temporary list lets the canonical bitmap-cell extractor apply
    ;; the colour key and create private colour/mask planes for each new cell.
    (local.set $probe (call $heap_alloc (i32.const 36)))
    (if (i32.eqz (local.get $probe))
      (then
        (call $image_list_destroy_icon_array
          (local.get $new_icons) (local.get $count))
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $probe_wa (call $g2w (local.get $probe)))
    (call $zero_memory (local.get $probe_wa) (i32.const 36))
    (i32.store          (local.get $probe_wa) (local.get $cx))
    (i32.store offset=4 (local.get $probe_wa) (local.get $cy))
    (i32.store offset=12 (local.get $probe_wa) (local.get $add_count))
    (i32.store offset=16 (local.get $probe_wa) (local.get $arg1))
    (i32.store offset=20 (local.get $probe_wa) (local.get $arg2))
    (i32.store offset=32 (local.get $probe_wa) (i32.const 0x4C4D4948))
    (local.set $i (i32.const 0))
    (block $new_done (loop $new_entries
      (br_if $new_done (i32.ge_u (local.get $i) (local.get $add_count)))
      (local.set $icon
        (call $image_list_icon_handle (local.get $probe) (local.get $i)))
      (if (i32.eqz (local.get $icon))
        (then
          (call $heap_free (local.get $probe))
          (call $image_list_destroy_icon_array
            (local.get $new_icons) (i32.add (local.get $count) (local.get $i)))
          (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
          (return)))
      (i32.store (i32.add (local.get $new_icons_wa)
        (i32.shl (i32.add (local.get $count) (local.get $i)) (i32.const 2)))
        (local.get $icon))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $new_entries)))
    (call $heap_free (local.get $probe))

    (local.set $old_icons (i32.load offset=24 (local.get $sw)))
    (call $image_list_destroy_icon_array
      (local.get $old_icons) (local.get $count))
    (i32.store offset=12 (local.get $sw) (local.get $new_count))
    (i32.store offset=16 (local.get $sw) (i32.const 0))
    (i32.store offset=20 (local.get $sw) (i32.const -1))
    (i32.store offset=24 (local.get $sw) (local.get $new_icons))
    (i32.store offset=28 (local.get $sw) (local.get $capacity))
    (global.set $eax (local.get $count))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; ImageList_ReplaceIcon(himl, i, hicon) — replace an existing image, or
  ;; append when i == -1. Returns the resulting image index, or -1 on error.
  (func $handle_ImageList_ReplaceIcon (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $sw i32) (local $count i32) (local $index i32)
    (local $icons i32) (local $icons_wa i32) (local $capacity i32)
    (local $new_icons i32) (local $new_icons_wa i32) (local $new_capacity i32)
    (local $copy i32) (local $old i32)
    (global.set $eax (i32.const -1))
    (if (i32.or (i32.eqz (local.get $arg0)) (i32.eqz (local.get $arg2)))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $sw (call $g2w (local.get $arg0)))
    (local.set $count (i32.load offset=12 (local.get $sw)))
    (local.set $index (local.get $arg1))
    (if (i32.eq (local.get $index) (i32.const -1))
      (then (local.set $index (local.get $count)))
      (else
        (if (i32.ge_u (local.get $index) (local.get $count))
          (then
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))))
    ;; Common controls copies the icon's image and mask; it never retains the
    ;; caller's HICON. This private copy lets the caller destroy hicon as soon
    ;; as ImageList_ReplaceIcon returns, exactly as the Win32 contract allows.
    (local.set $copy (call $icon_copy_handle (local.get $arg2)))
    (if (i32.eqz (local.get $copy))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $icons (i32.load offset=24 (local.get $sw)))
    (if (local.get $icons)
      (then (local.set $icons_wa (call $g2w (local.get $icons)))))
    (local.set $capacity (i32.load offset=28 (local.get $sw)))
    (if (i32.ge_u (local.get $index) (local.get $capacity))
      (then
        (local.set $new_capacity (i32.shl (local.get $capacity) (i32.const 1)))
        (if (i32.lt_u (local.get $new_capacity) (i32.const 4))
          (then (local.set $new_capacity (i32.const 4))))
        (if (i32.le_u (local.get $new_capacity) (local.get $index))
          (then (local.set $new_capacity (i32.add (local.get $index) (i32.const 1)))))
        ;; A bitmap-backed list can already expose many cells without an icon
        ;; array.  Replacing any one cell needs addressable slots for every
        ;; logical image, otherwise GetIcon/Destroy would read past capacity.
        (if (i32.lt_u (local.get $new_capacity) (local.get $count))
          (then (local.set $new_capacity (local.get $count))))
        (local.set $new_icons
          (call $heap_alloc (i32.shl (local.get $new_capacity) (i32.const 2))))
        (if (i32.eqz (local.get $new_icons))
          (then
            (drop (call $icon_destroy_handle (local.get $copy)))
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))
        (local.set $new_icons_wa (call $g2w (local.get $new_icons)))
        (call $zero_memory (local.get $new_icons_wa)
          (i32.shl (local.get $new_capacity) (i32.const 2)))
        (if (local.get $icons)
          (then
            (call $memcpy (local.get $new_icons_wa) (local.get $icons_wa)
              (i32.shl (local.get $capacity) (i32.const 2)))))
        (local.set $icons (local.get $new_icons))
        (local.set $icons_wa (local.get $new_icons_wa))
        (local.set $capacity (local.get $new_capacity))
        (i32.store offset=24 (local.get $sw) (local.get $icons))
        (i32.store offset=28 (local.get $sw) (local.get $capacity))))
    (if (i32.lt_u (local.get $index) (local.get $count))
      (then
        (local.set $old (i32.load (i32.add (local.get $icons_wa)
          (i32.shl (local.get $index) (i32.const 2)))))
        (if (local.get $old)
          (then (drop (call $icon_destroy_handle (local.get $old)))))))
    (i32.store (i32.add (local.get $icons_wa)
      (i32.shl (local.get $index) (i32.const 2))) (local.get $copy))
    (if (i32.eq (local.get $index) (local.get $count))
      (then (i32.store offset=12 (local.get $sw) (i32.add (local.get $count) (i32.const 1)))))
    (global.set $eax (local.get $index))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; ImageList_GetIcon(himl, i, flags) — create an independent HICON from the
  ;; entry's image and mask. The caller owns the result and releases it with
  ;; DestroyIcon. ILD_NORMAL/ILD_TRANSPARENT share the same stored planes;
  ;; overlay/blend styling remains a draw-time compatibility extension.
  (func $handle_ImageList_GetIcon (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (global.set $eax (call $image_list_icon_handle (local.get $arg0) (local.get $arg1)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; ImageList_Remove(himl, i) — remove one image and close the index gap, or
  ;; remove every image when i == -1.  Rebuild through owned HICONs before
  ;; mutating the live list so a bitmap-backed list remains unchanged if any
  ;; source cell cannot be materialized.
  (func $handle_ImageList_Remove (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $sw i32) (local $count i32) (local $new_count i32)
    (local $old_icons i32) (local $new_icons i32) (local $new_icons_wa i32)
    (local $capacity i32) (local $source_index i32) (local $dest_index i32)
    (local $icon i32)
    (global.set $eax (i32.const 0))
    (if (i32.eqz (local.get $arg0))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    ;; SHGFI_SYSICONINDEX lists are shared process resources and cannot be
    ;; changed by applications.
    (if (i32.or
          (i32.eq (local.get $arg0)
            (i32.atomic.load (global.get $SHELL_FILE_INFO)))
          (i32.eq (local.get $arg0)
            (i32.atomic.load offset=4 (global.get $SHELL_FILE_INFO))))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $sw (call $g2w (local.get $arg0)))
    (if (i32.ne (i32.load offset=32 (local.get $sw)) (i32.const 0x4C4D4948))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $count (i32.load offset=12 (local.get $sw)))
    (local.set $old_icons (i32.load offset=24 (local.get $sw)))

    (if (i32.eq (local.get $arg1) (i32.const -1))
      (then
        (call $image_list_destroy_icon_array
          (local.get $old_icons) (local.get $count))
        (i32.store offset=12 (local.get $sw) (i32.const 0))
        (i32.store offset=16 (local.get $sw) (i32.const 0))
        (i32.store offset=20 (local.get $sw) (i32.const -1))
        (i32.store offset=24 (local.get $sw) (i32.const 0))
        (i32.store offset=28 (local.get $sw) (i32.const 0))
        (global.set $eax (i32.const 1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (if (i32.ge_u (local.get $arg1) (local.get $count))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))

    (local.set $new_count (i32.sub (local.get $count) (i32.const 1)))
    (if (local.get $new_count)
      (then
        (local.set $capacity (i32.const 4))
        (block $capacity_ready (loop $grow_capacity
          (br_if $capacity_ready
            (i32.ge_u (local.get $capacity) (local.get $new_count)))
          (local.set $capacity
            (i32.shl (local.get $capacity) (i32.const 1)))
          (br $grow_capacity)))
        (local.set $new_icons
          (call $heap_alloc (i32.shl (local.get $capacity) (i32.const 2))))
        (if (i32.eqz (local.get $new_icons))
          (then
            (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
            (return)))
        (local.set $new_icons_wa (call $g2w (local.get $new_icons)))
        (call $zero_memory (local.get $new_icons_wa)
          (i32.shl (local.get $capacity) (i32.const 2)))
        (block $done (loop $entries
          (br_if $done
            (i32.ge_u (local.get $source_index) (local.get $count)))
          (if (i32.ne (local.get $source_index) (local.get $arg1))
            (then
              (local.set $icon (call $image_list_icon_handle
                (local.get $arg0) (local.get $source_index)))
              (if (i32.eqz (local.get $icon))
                (then
                  (call $image_list_destroy_icon_array
                    (local.get $new_icons) (local.get $dest_index))
                  (global.set $esp
                    (i32.add (global.get $esp) (i32.const 12)))
                  (return)))
              (i32.store (i32.add (local.get $new_icons_wa)
                (i32.shl (local.get $dest_index) (i32.const 2)))
                (local.get $icon))
              (local.set $dest_index
                (i32.add (local.get $dest_index) (i32.const 1)))))
          (local.set $source_index
            (i32.add (local.get $source_index) (i32.const 1)))
          (br $entries)))))

    (call $image_list_destroy_icon_array
      (local.get $old_icons) (local.get $count))
    (i32.store offset=12 (local.get $sw) (local.get $new_count))
    (i32.store offset=16 (local.get $sw) (i32.const 0))
    (i32.store offset=20 (local.get $sw) (i32.const -1))
    (i32.store offset=24 (local.get $sw) (local.get $new_icons))
    (i32.store offset=28 (local.get $sw) (local.get $capacity))
    (global.set $eax (i32.const 1))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  (func $create_status_window
    (param $style i32) (param $text_wa i32) (param $parent i32) (param $id i32)
    (result i32)
    (local $hwnd i32)
    (local.set $hwnd (call $ctrl_create_child
      (local.get $parent) (i32.const 22) (local.get $id)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 20)
      (local.get $style) (i32.const 0)))
    (drop (call $host_create_window
      (local.get $hwnd) (local.get $style)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 20)
      (local.get $text_wa) (local.get $id)))
    (call $host_set_parent (local.get $hwnd) (local.get $parent))
    (call $host_set_window_class (local.get $hwnd) (region.addr $CLASS_NAME_STRINGS 0x160))
    (local.get $hwnd))

  ;; CreateStatusWindowA(style, lpszText, hwndParent, wID) — 4 args, returns HWND
  (func $handle_CreateStatusWindowA (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (global.set $eax (call $create_status_window
      (local.get $arg0)
      (if (result i32) (local.get $arg1) (then (call $g2w (local.get $arg1))) (else (i32.const 0)))
      (local.get $arg2) (local.get $arg3)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 20)))
  )

  ;; CreateToolbarEx — 13 args, returns HWND of toolbar
  (func $handle_CreateToolbarEx (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; CreateToolbarEx(hwndParent, ws, wID, nBitmaps, hBMInst, wBMID, lpButtons, iNumButtons, dxButton, dyButton, dxBitmap, dyBitmap, uStructSize)
    (local $wa_esp i32) (local $hwnd i32) (local $state i32) (local $sw i32)
    (local $buttons i32) (local $button_count i32) (local $button_w i32) (local $button_h i32)
    (local $bitmap_w i32) (local $bitmap_h i32) (local $struct_size i32) (local $bmp i32)
    (local.set $wa_esp (call $g2w (global.get $esp)))
    (local.set $buttons (i32.load offset=28 (local.get $wa_esp)))
    (local.set $button_count (i32.load offset=32 (local.get $wa_esp)))
    (local.set $button_w (i32.load offset=36 (local.get $wa_esp)))
    (local.set $button_h (i32.load offset=40 (local.get $wa_esp)))
    (local.set $bitmap_w (i32.load offset=44 (local.get $wa_esp)))
    (local.set $bitmap_h (i32.load offset=48 (local.get $wa_esp)))
    (local.set $struct_size (i32.load offset=52 (local.get $wa_esp)))
    ;; Win9x common controls treat these as requested image/button extents,
    ;; then retain the standard face padding around the bitmap. Media Player
    ;; passes equal 16x16 values and expects the familiar 23x22 transport
    ;; buttons, not tightly cropped 16x16 faces.
    (if (i32.le_u (local.get $button_w) (local.get $bitmap_w))
      (then (local.set $button_w (i32.add (local.get $bitmap_w) (i32.const 7)))))
    (if (i32.le_u (local.get $button_h) (local.get $bitmap_h))
      (then (local.set $button_h (i32.add (local.get $bitmap_h) (i32.const 6)))))
    ;; Create a real class-21 child so SendMessage routes through the toolbar
    ;; control model. The old renderer-only HWND had no parent/control state,
    ;; causing Media Player's layout messages to enter its application wndproc.
    (local.set $hwnd (call $ctrl_create_child
      (local.get $arg0) (i32.const 21) (local.get $arg2)
      (i32.const 0) (i32.const 0) (i32.const 100) (i32.const 30)
      (local.get $arg1) (i32.const 0)))
    (drop (call $host_create_window
      (local.get $hwnd) (local.get $arg1)
      (i32.const 0) (i32.const 0) (i32.const 100) (i32.const 30)
      (i32.const 0) (local.get $arg2)))
    (call $wnd_set_parent (local.get $hwnd) (local.get $arg0))
    (call $host_set_parent (local.get $hwnd) (local.get $arg0))
    (call $host_set_window_class (local.get $hwnd) (region.addr $CLASS_NAME_STRINGS 0x174))
    (local.set $state (call $toolbar_ensure_state (local.get $hwnd)))
    (local.set $sw (call $g2w (local.get $state)))
    (if (local.get $button_w) (then (i32.store offset=4 (local.get $sw) (local.get $button_w))))
    (if (local.get $button_h) (then (i32.store offset=8 (local.get $sw) (local.get $button_h))))
    (if (local.get $bitmap_w) (then (i32.store offset=12 (local.get $sw) (local.get $bitmap_w))))
    (if (local.get $bitmap_h) (then (i32.store offset=16 (local.get $sw) (local.get $bitmap_h))))
    (if (local.get $struct_size) (then (i32.store offset=24 (local.get $sw) (local.get $struct_size))))
    ;; CreateToolbarEx supplies the initial strip directly instead of sending
    ;; TB_ADDBITMAP. Load it here so the copied iBitmap indices have pixels.
    (if (local.get $arg3)
      (then
        (local.set $bmp (call $host_gdi_load_bitmap (local.get $arg4)
          (i32.and (i32.load offset=24 (local.get $wa_esp)) (i32.const 0xFFFF))))
        (if (local.get $bmp)
          (then
            (i32.store offset=48 (local.get $sw) (local.get $bmp))
            (i32.store offset=28 (local.get $sw) (local.get $arg3))))))
    (if (i32.and
          (i32.ne (local.get $buttons) (i32.const 0))
          (i32.ne (local.get $button_count) (i32.const 0)))
      (then
        (drop (call $toolbar_ensure_capacity (local.get $sw) (local.get $button_count)))
        (local.set $state (i32.const 0))
        (block $done (loop $copy
          (br_if $done (i32.ge_u (local.get $state) (local.get $button_count)))
          (call $toolbar_copy_button_in
            (call $toolbar_button_ptr (local.get $sw) (local.get $state))
            (i32.add (local.get $buttons) (i32.mul (local.get $state) (local.get $struct_size)))
            (local.get $struct_size) (local.get $state))
          (local.set $state (i32.add (local.get $state) (i32.const 1)))
          (br $copy)))
        (i32.store (local.get $sw) (local.get $button_count))))
    (call $toolbar_autosize (local.get $hwnd))
    (global.set $eax (local.get $hwnd))
    (global.set $esp (i32.add (global.get $esp) (i32.const 56)))  ;; stdcall, 13 args
  )

  ;; CreateUpDownControl — 12 args, returns HWND
  (func $handle_CreateUpDownControl (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; CreateUpDownControl(dwStyle, x, y, cx, cy, hParent, nID, hInst, hBuddy, nUpper, nLower, nPos)
    (global.set $eax (call $host_create_window
      (global.get $next_hwnd)
      (local.get $arg0) ;; style
      (local.get $arg1) ;; x
      (local.get $arg2) ;; y
      (local.get $arg3) ;; cx
      (local.get $arg4) ;; cy
      (i32.const 0) ;; no text
      (i32.const 0)))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 52)))  ;; stdcall, 12 args
  )

  ;; GetEffectiveClientRect(hWnd, lprc, lpInfo) — 3 args, void
  (func $handle_GetEffectiveClientRect (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $rect i32) (local $info i32) (local $cs i32)
    (local $pair_count i32) (local $child i32)
    (local $xy i32) (local $wh i32)
    (local $x i32) (local $y i32) (local $w i32) (local $h i32)
    ;; The SDK requires valid output and mapping pointers. Keep the browser
    ;; process alive for malformed callers while retaining the useful part of
    ;; the contract: a null table still receives the ordinary client rect.
    (if (i32.eqz (local.get $arg1))
      (then
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $rect (call $g2w (local.get $arg1)))
    (local.set $cs (call $wnd_get_client_size_packed (local.get $arg0)))
    (store.field Rect left (local.get $rect) (i32.const 0))
    (store.field.memarg Rect top (local.get $rect) (i32.const 0))
    (store.field.memarg Rect right (local.get $rect)
      (i32.and (local.get $cs) (i32.const 0xFFFF)))
    (store.field.memarg Rect bottom (local.get $rect)
      (i32.shr_u (local.get $cs) (i32.const 16)))
    (if (local.get $arg2)
      (then
        ;; Win98 comctl32 skips the first pair (the menu entry), then treats
        ;; each following pair as selector/control-id until selector == 0.
        (local.set $info (i32.add (call $g2w (local.get $arg2)) (i32.const 8)))
        (block $done (loop $controls
          ;; Bound a malformed unterminated table rather than walking arbitrary
          ;; host memory forever. Valid Win32 tables terminate long before this.
          (br_if $done (i32.ge_u (local.get $pair_count) (i32.const 256)))
          (br_if $done (i32.eqz (i32.load (local.get $info))))
          (local.set $child
            (call $ctrl_find_by_id
              (local.get $arg0) (i32.load offset=4 (local.get $info))))
          ;; Checking WS_VISIBLE itself, rather than effective ancestor
          ;; visibility, is what makes a child count while a hidden parent is
          ;; waiting to be shown; this is both the SDK rule and Win98's test.
          (if (i32.and
                (i32.ne (local.get $child) (i32.const 0))
                (i32.ne
                  (i32.and (call $wnd_get_style (local.get $child))
                           (i32.const 0x10000000))
                  (i32.const 0)))
            (then
              ;; GetDlgItem guarantees a direct child here. CONTROL_GEOM is
              ;; stored in parent-client coordinates, exactly the result of
              ;; Win98's GetWindowRect + MapWindowPoints(NULL, parent, ...).
              (local.set $xy (call $ctrl_get_xy_packed (local.get $child)))
              (local.set $wh (call $ctrl_get_wh_packed (local.get $child)))
              (local.set $x
                (i32.shr_s (i32.shl (local.get $xy) (i32.const 16)) (i32.const 16)))
              (local.set $y (i32.shr_s (local.get $xy) (i32.const 16)))
              (local.set $w (i32.and (local.get $wh) (i32.const 0xFFFF)))
              (local.set $h (i32.shr_u (local.get $wh) (i32.const 16)))
              (drop
                (call $rect_subtract_to_wa
                  (local.get $rect)
                  (load.field Rect left (local.get $rect))
                  (load.field.memarg Rect top (local.get $rect))
                  (load.field.memarg Rect right (local.get $rect))
                  (load.field.memarg Rect bottom (local.get $rect))
                  (local.get $x) (local.get $y)
                  (i32.add (local.get $x) (local.get $w))
                  (i32.add (local.get $y) (local.get $h))))))
          (local.set $info (i32.add (local.get $info) (i32.const 8)))
          (local.set $pair_count (i32.add (local.get $pair_count) (i32.const 1)))
          (br $controls)))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; DrawStatusTextA(hDC, lprc, pszText, uFlags) — 4 args, void
  (func $handle_DrawStatusTextA (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; Draw text through the supplied HDC so the child-window origin and clip
    ;; match USER/GDI. Comctl32 DrawStatusText uses a recessed border; for now
    ;; preserve the app-provided rect and flags, but avoid the old global
    ;; renderer text path.
    (if (local.get $arg2)
      (then
        (drop (call $host_gdi_draw_text
          (local.get $arg0) ;; hDC
          (call $g2w (local.get $arg2)) ;; text
          (i32.const -1) ;; nCount=-1 (null terminated)
          (call $g2w (local.get $arg1)) ;; lpRect
          (i32.or (local.get $arg3) (i32.const 0x24)) ;; DT_SINGLELINE|DT_VCENTER
          (i32.const 0))))) ;; ANSI
    (global.set $esp (i32.add (global.get $esp) (i32.const 20)))
  )

  ;; DrawStatusTextW — 4 args, void. Same draw as the A spelling, with the
  ;; text read as UTF-16; it used to skip the draw entirely, so a wide app's
  ;; status bar stayed blank.
  (func $handle_DrawStatusTextW (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (if (local.get $arg2)
      (then
        (drop (call $host_gdi_draw_text
          (local.get $arg0)                              ;; hDC
          (call $g2w (local.get $arg2))                  ;; text
          (i32.const -1)                                 ;; nCount=-1 (null terminated)
          (call $g2w (local.get $arg1))                  ;; lpRect
          (i32.or (local.get $arg3) (i32.const 0x24))    ;; DT_SINGLELINE|DT_VCENTER
          (i32.const 1)))))                              ;; wide
    (global.set $esp (i32.add (global.get $esp) (i32.const 20)))
  )

  ;; Resolve the RT_STRING id selected by WM_MENUSELECT. lpwIDs is already a
  ;; translated WASM address and has the historical MENUHELPUINTS shape:
  ;;   [command-id offset, main-menu popup-index offset,
  ;;    nested popup string id, nested popup HMENU, ..., 0, 0]
  ;; The public documentation describes the trailing pairs but omits the two
  ;; leading offsets; the Win98 comctl32 code and classic SDK usage require
  ;; both. A zero result means display an empty help string.
  (func $menu_help_resource_id
      (param $wParam i32) (param $lParam i32) (param $hMainMenu i32)
      (param $ids_w i32) (result i32)
    (local $flags i32) (local $item i32) (local $submenu i32)
    (local $pair i32) (local $i i32) (local $string_id i32)
    (if (i32.eqz (local.get $ids_w)) (then (return (i32.const 0))))
    (local.set $flags (i32.shr_u (local.get $wParam) (i32.const 16)))
    (local.set $item (i32.and (local.get $wParam) (i32.const 0xFFFF)))
    (if (i32.or
          (i32.ne (i32.and (local.get $flags) (i32.const 0x800)) (i32.const 0)) ;; MF_SEPARATOR
          (i32.ne (i32.and (local.get $flags) (i32.const 0x2000)) (i32.const 0))) ;; MF_SYSMENU
      (then (return (i32.const 0))))
    (if (i32.eqz (i32.and (local.get $flags) (i32.const 0x10))) ;; !MF_POPUP
      (then (return (i32.add (i32.load (local.get $ids_w)) (local.get $item)))))
    ;; Direct children of the main menu use their zero-based position plus the
    ;; second offset. Nested popups use the explicit (string id, HMENU) pairs.
    (if (i32.eq (local.get $lParam) (local.get $hMainMenu))
      (then (return (i32.add (i32.load offset=4 (local.get $ids_w)) (local.get $item)))))
    (local.set $submenu
      (call $menu_handle_submenu (local.get $lParam) (local.get $item)))
    (if (i32.eqz (local.get $submenu)) (then (return (i32.const 0))))
    (local.set $pair (i32.add (local.get $ids_w) (i32.const 8)))
    ;; The native routine walks to a zero string id. Bound malformed caller
    ;; input so a bad table cannot turn one guest call into an unending host run.
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $i) (i32.const 256)))
        (local.set $string_id (i32.load (local.get $pair)))
        (br_if $done (i32.eqz (local.get $string_id)))
        (if (i32.eq (i32.load offset=4 (local.get $pair)) (local.get $submenu))
          (then (return (local.get $string_id))))
        (local.set $pair (i32.add (local.get $pair) (i32.const 8)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))
    (i32.const 0))

  ;; MenuHelp(uMsg, wParam, lParam, hMainMenu, hInst, hwndStatus, lpwIDs)
  ;; — 7 args, void. Win98's implementation handles WM_MENUSELECT, writes a
  ;; UTF-16 string to status-bar simple part 0xFF, and leaves WM_COMMAND alone
  ;; despite the broader wording in current documentation.
  (func $handle_MenuHelp (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $hwnd_status i32) (local $ids_g i32) (local $ids_w i32)
    (local $flags i32) (local $string_id i32) (local $buf_g i32)
    ;; The generic handler ABI passes five register locals; remaining stdcall
    ;; arguments stay on the guest stack after the return address and arg0..4.
    (local.set $hwnd_status
      (call $gl32 (i32.add (global.get $esp) (i32.const 24))))
    (local.set $ids_g
      (call $gl32 (i32.add (global.get $esp) (i32.const 28))))
    (if (i32.eq (local.get $arg0) (i32.const 0x011F)) ;; WM_MENUSELECT
      (then
        (local.set $flags (i32.shr_u (local.get $arg1) (i32.const 16)))
        ;; WM_MENUSELECT's closed sentinel returns the status bar to its normal
        ;; panes. Win98 requires lParam==NULL as well as flags==0xFFFF.
        (if (i32.and
              (i32.eq (local.get $flags) (i32.const 0xFFFF))
              (i32.eqz (local.get $arg2)))
          (then
            (drop (call $wnd_send_message
              (local.get $hwnd_status) (i32.const 0x0409) ;; SB_SIMPLE
              (i32.const 0) (i32.const 0))))
          (else
            (local.set $ids_w
              (if (result i32) (local.get $ids_g)
                (then (call $g2w (local.get $ids_g)))
                (else (i32.const 0))))
            (local.set $string_id (call $menu_help_resource_id
              (local.get $arg1) (local.get $arg2) (local.get $arg3)
              (local.get $ids_w)))
            (local.set $buf_g (call $heap_alloc (i32.const 512)))
            (if (local.get $buf_g)
              (then
                (memory.fill (call $g2w (local.get $buf_g)) (i32.const 0) (i32.const 512))
                (if (local.get $string_id)
                  (then
                    (call $push_rsrc_ctx (local.get $arg4))
                    (drop (call $string_load_w
                      (local.get $string_id) (call $g2w (local.get $buf_g))
                      (i32.const 256)))
                    (call $pop_rsrc_ctx)))))
            (drop (call $wnd_send_message
              (local.get $hwnd_status) (i32.const 0x040B) ;; SB_SETTEXTW
              (i32.const 0x01FF) (local.get $buf_g)))
            (drop (call $wnd_send_message
              (local.get $hwnd_status) (i32.const 0x0409) ;; SB_SIMPLE
              (i32.const 1) (i32.const 0)))
            (if (local.get $buf_g) (then (call $heap_free (local.get $buf_g))))))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 32)))
  )

  ;; Show or hide one mapped child while keeping its menu check synchronized.
  ;; This is the child-window subset of ShowWindow that ShowHideMenuCtl uses;
  ;; it retains the browser surface, USER style, WM_SHOWWINDOW, invalidation,
  ;; and hidden-subtree cleanup without running top-level activation policy.
  (func $show_hide_menu_control_visible
      (param $hwnd i32) (param $show i32) (result i32)
    (if (i32.eqz (call $wnd_table_get (local.get $hwnd)))
      (then (return (i32.const 0))))
    (drop (call $post_queue_push
      (local.get $hwnd) (i32.const 0x0018) ;; WM_SHOWWINDOW
      (local.get $show) (i32.const 0)))
    (drop (call $host_show_window
      (local.get $hwnd) (select (i32.const 5) (i32.const 0) (local.get $show))))
    (call $wnd_apply_show_state
      (local.get $hwnd) (select (i32.const 5) (i32.const 0) (local.get $show)))
    (if (local.get $show)
      (then
        (drop (call $wnd_set_style (local.get $hwnd)
          (i32.or (call $wnd_get_style (local.get $hwnd)) (i32.const 0x10000000))))
        (call $nc_flags_set (local.get $hwnd) (i32.const 2))
        (call $paint_flag_set_inv (local.get $hwnd))
        (drop (call $paint_seed_child_paints (local.get $hwnd))))
      (else
        (call $wnd_uncover_parent (local.get $hwnd))
        (drop (call $wnd_set_style (local.get $hwnd)
          (i32.and (call $wnd_get_style (local.get $hwnd)) (i32.const 0xEFFFFFFF))))
        (call $paint_clear_subtree (local.get $hwnd))))
    (i32.const 1))

  ;; The first lpInfo pair maps a selector to the application's whole menu.
  ;; Reuse SetMenu's handle normalization and non-client repaint sequence.
  (func $show_hide_menu_bar
      (param $hwnd i32) (param $hmenu i32) (param $show i32) (result i32)
    (local $menu_key i32)
    (if (i32.eqz (call $wnd_table_get (local.get $hwnd)))
      (then (return (i32.const 0))))
    (local.set $menu_key (select (local.get $hmenu) (i32.const 0) (local.get $show)))
    (if (i32.and
          (local.get $show)
          (i32.or
            (i32.eq (local.get $menu_key) (i32.const 0x00080001))
            (i32.eq
              (i32.and (local.get $menu_key) (i32.const 0xFFFF0000))
              (i32.const 0x00BE0000))))
      (then (local.set $menu_key
        (i32.and (local.get $menu_key) (i32.const 0xFFFF)))))
    (call $menu_load (local.get $hwnd) (local.get $menu_key))
    (call $defwndproc_do_nccalcsize (local.get $hwnd))
    (call $host_set_menu (local.get $hwnd) (local.get $menu_key))
    (if (call $wnd_is_effectively_visible (local.get $hwnd))
      (then
        (call $defwndproc_do_ncpaint (local.get $hwnd))
        (call $paint_flag_set_inv (local.get $hwnd))))
    (i32.const 1))

  ;; ShowHideMenuCtl(hWnd, uFlags, lpInfo) — 3 args, returns BOOL.
  ;; lpInfo is {selector, main HMENU}, followed by {menu id, child control id}
  ;; pairs and a zero selector terminator. Win98 toggles from the menu item's
  ;; current MF_CHECKED state rather than from the window's visibility bit.
  (func $handle_ShowHideMenuCtl (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $info_w i32) (local $pair i32) (local $hmenu i32)
    (local $index i32) (local $old_state i32) (local $new_check i32)
    (local $ctrl i32) (local $result i32)
    (if (i32.and
          (i32.ne (call $wnd_table_get (local.get $arg0)) (i32.const 0))
          (i32.ne (local.get $arg2) (i32.const 0)))
      (then
        ;; Translate the caller's pair table once; every scan/load below uses
        ;; the same WASM address rather than repeatedly converting arg2.
        (local.set $info_w (call $g2w (local.get $arg2)))
        (local.set $hmenu (i32.load offset=4 (local.get $info_w)))
        (local.set $pair (local.get $info_w))
        (block $done
          (loop $scan
            (br_if $done (i32.ge_u (local.get $index) (i32.const 256)))
            (br_if $done (i32.eqz (i32.load (local.get $pair))))
            (if (i32.eq (i32.load (local.get $pair)) (local.get $arg1))
              (then
                (if (i32.eqz (local.get $index))
                  (then
                    ;; Once detached, its menu blob is intentionally absent;
                    ;; attachment state is the durable truth for this special
                    ;; pair and makes the next call reattach it.
                    (local.set $new_check
                      (select (i32.const 0) (i32.const 8)
                        (i32.ne (call $menu_source_get (local.get $arg0)) (i32.const 0))))
                    (local.set $result (call $show_hide_menu_bar
                      (local.get $arg0) (local.get $hmenu)
                      (i32.ne (local.get $new_check) (i32.const 0)))))
                  (else
                    (local.set $old_state
                      (call $menu_handle_state_by_id (local.get $hmenu) (local.get $arg1)))
                    (local.set $new_check
                      (select (i32.const 0) (i32.const 8)
                        (i32.ne (i32.and (local.get $old_state) (i32.const 8)) (i32.const 0))))
                    (local.set $ctrl (call $ctrl_find_by_id
                      (local.get $arg0) (i32.load offset=4 (local.get $pair))))
                    (if (local.get $ctrl)
                      (then (local.set $result (call $show_hide_menu_control_visible
                        (local.get $ctrl) (i32.ne (local.get $new_check) (i32.const 0)))))
                      (else (local.set $new_check (i32.const 0))))))
                ;; Win98 updates the main menu and its first submenu. The WAT
                ;; menu mutation walks the whole attached blob, so one call
                ;; covers both identities without double-toggling anything.
                (drop (call $menu_check_item_global
                  (local.get $arg1) (local.get $new_check)))
                (br $done)))
            (local.set $pair (i32.add (local.get $pair) (i32.const 8)))
            (local.set $index (i32.add (local.get $index) (i32.const 1)))
            (br $scan)))))
    (global.set $eax (local.get $result))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; Convert COLORREF (00BBGGRR) to the RGBQUAD word used by owned indexed
  ;; bitmap palettes (00RRGGBB).
  (func $mapped_bitmap_palette_color (param $colorref i32) (result i32)
    (call $gdi_raster_swap_rb (i32.and (local.get $colorref) (i32.const 0x00FFFFFF))))

  ;; Win98's six default toolbar mappings. The source colors are COLORREFs;
  ;; the targets are resolved through the process's current system colors.
  (func $mapped_bitmap_default_from (param $index i32) (result i32)
    (if (i32.eq (local.get $index) (i32.const 0)) (then (return (i32.const 0x00000000))))
    (if (i32.eq (local.get $index) (i32.const 1)) (then (return (i32.const 0x00808080))))
    (if (i32.eq (local.get $index) (i32.const 2)) (then (return (i32.const 0x00C0C0C0))))
    (if (i32.eq (local.get $index) (i32.const 3)) (then (return (i32.const 0x00FFFFFF))))
    (if (i32.eq (local.get $index) (i32.const 4)) (then (return (i32.const 0x00FF0000))))
    (i32.const 0x00FF00FF))

  (func $mapped_bitmap_default_to (param $index i32) (result i32)
    (if (i32.eq (local.get $index) (i32.const 0)) (then (return (call $win98_sys_color (i32.const 18)))))
    (if (i32.eq (local.get $index) (i32.const 1)) (then (return (call $win98_sys_color (i32.const 16)))))
    (if (i32.eq (local.get $index) (i32.const 2)) (then (return (call $win98_sys_color (i32.const 15)))))
    (if (i32.eq (local.get $index) (i32.const 3)) (then (return (call $win98_sys_color (i32.const 20)))))
    (if (i32.eq (local.get $index) (i32.const 4)) (then (return (call $win98_sys_color (i32.const 13)))))
    (call $win98_sys_color (i32.const 5)))

  ;; Apply at most Win98's 16 accepted COLORMAP entries to an indexed bitmap's
  ;; owned palette. $map is a translated WASM pointer, or zero for the six
  ;; system-color defaults above.
  (func $mapped_bitmap_apply_colors
      (param $bitmap i32) (param $map i32) (param $map_count i32)
    (local $record i32) (local $palette i32) (local $palette_count i32)
    (local $i i32) (local $j i32) (local $entry i32)
    (local $from i32) (local $to i32)
    (local.set $record (call $gdi_object_record (local.get $bitmap)))
    (if (i32.eqz (call $gdi_bitmap_record_valid (local.get $record))) (then (return)))
    (local.set $palette (load.field.memarg GdiBitmap palette (local.get $record)))
    (local.set $palette_count
      (load.field.memarg GdiBitmap palette_count (local.get $record)))
    ;; A 16-bpp mask triplet uses the same record fields but is not a color
    ;; table. CreateMappedBitmap is fully defined only for <=256-color images.
    (if (i32.or
          (i32.eqz (local.get $palette))
          (i32.or
            (i32.gt_u (load.field.memarg GdiBitmap bpp (local.get $record)) (i32.const 8))
            (i32.le_s (local.get $map_count) (i32.const 0))))
      (then (return)))
    (if (i32.gt_s (local.get $map_count) (i32.const 16))
      (then (local.set $map_count (i32.const 16))))
    (block $palette_done (loop $palette_entries
      (br_if $palette_done (i32.ge_u (local.get $i) (local.get $palette_count)))
      (local.set $entry
        (i32.and
          (i32.load (i32.add (local.get $palette) (i32.shl (local.get $i) (i32.const 2))))
          (i32.const 0x00FFFFFF)))
      (local.set $j (i32.const 0))
      (block $maps_done (loop $maps
        (br_if $maps_done (i32.ge_u (local.get $j) (local.get $map_count)))
        (if (local.get $map)
          (then
            (local.set $from (call $mapped_bitmap_palette_color
              (i32.load (i32.add (local.get $map) (i32.shl (local.get $j) (i32.const 3))))))
            (local.set $to (call $mapped_bitmap_palette_color
              (i32.load offset=4
                (i32.add (local.get $map) (i32.shl (local.get $j) (i32.const 3)))))))
          (else
            (local.set $from (call $mapped_bitmap_palette_color
              (call $mapped_bitmap_default_from (local.get $j))))
            (local.set $to (call $mapped_bitmap_palette_color
              (call $mapped_bitmap_default_to (local.get $j))))))
        (if (i32.eq (local.get $entry) (local.get $from))
          (then
            (i32.store
              (i32.add (local.get $palette) (i32.shl (local.get $i) (i32.const 2)))
              (local.get $to))
            (br $maps_done)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $maps)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $palette_entries)))
    ;; The browser surface is a derived presentation of this WAT-owned record;
    ;; refresh it after changing the canonical palette.
    (drop (call $host_gdi_surface_upload
      (local.get $bitmap) (i32.const 0) (i32.const 0)
      (load.field.memarg GdiBitmap width (local.get $record))
      (load.field.memarg GdiBitmap height (local.get $record)))))

  ;; CMB_MASKED returns a display bitmap twice the source width: the mapped
  ;; color image occupies the left half and a black/white transparency mask
  ;; occupies the right. Win98 derives that mask after color mapping, with
  ;; mapped magenta as white and every other pixel as black.
  (func $mapped_bitmap_create_masked (param $source i32) (result i32)
    (local $record i32) (local $width i32) (local $height i32)
    (local $result i32) (local $scratch_g i32) (local $scratch i32)
    (local $src_desc i32) (local $dst_desc i32)
    (local $x i32) (local $y i32) (local $color i32)
    (local.set $record (call $gdi_object_record (local.get $source)))
    (if (i32.eqz (call $gdi_bitmap_record_valid (local.get $record)))
      (then (return (i32.const 0))))
    (local.set $width (load.field.memarg GdiBitmap width (local.get $record)))
    (local.set $height (load.field.memarg GdiBitmap height (local.get $record)))
    (if (i32.gt_u (local.get $width) (i32.const 0x3FFFFFFF))
      (then (return (i32.const 0))))
    (local.set $result (call $gdi_bitmap_create_bitmap
      (i32.shl (local.get $width) (i32.const 1)) (local.get $height)
      (i32.const 1) (i32.const 32) (i32.const 0)))
    (if (i32.eqz (local.get $result)) (then (return (i32.const 0))))
    (local.set $scratch_g (call $heap_alloc (i32.const 160)))
    (if (i32.eqz (local.get $scratch_g))
      (then
        (drop (call $gdi_object_delete_full (local.get $result)))
        (return (i32.const 0))))
    (local.set $scratch (call $g2w (local.get $scratch_g)))
    (local.set $src_desc (local.get $scratch))
    (local.set $dst_desc (i32.add (local.get $scratch) (i32.const 80)))
    (if (i32.eqz (i32.and
          (call $gdi_raster_desc_from_bitmap (local.get $source) (local.get $src_desc))
          (call $gdi_raster_desc_from_bitmap (local.get $result) (local.get $dst_desc))))
      (then
        (call $heap_free (local.get $scratch_g))
        (drop (call $gdi_object_delete_full (local.get $result)))
        (return (i32.const 0))))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_u (local.get $y) (local.get $height)))
      (local.set $x (i32.const 0))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_u (local.get $x) (local.get $width)))
        (local.set $color
          (call $gdi_raster_read (local.get $src_desc) (local.get $x) (local.get $y)))
        (drop (call $gdi_raster_write
          (local.get $dst_desc) (local.get $x) (local.get $y) (local.get $color)))
        (drop (call $gdi_raster_write
          (local.get $dst_desc) (i32.add (local.get $x) (local.get $width))
          (local.get $y)
          (select (i32.const 0x00FFFFFF) (i32.const 0)
            (i32.eq (i32.and (local.get $color) (i32.const 0x00FFFFFF))
                    (i32.const 0x00FF00FF)))))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $cols)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $rows)))
    (call $heap_free (local.get $scratch_g))
    (drop (call $host_gdi_surface_upload
      (local.get $result) (i32.const 0) (i32.const 0)
      (i32.shl (local.get $width) (i32.const 1)) (local.get $height)))
    (local.get $result))

  ;; CreateMappedBitmap(hInstance, idBitmap, wFlags, lpColorMap, iNumMaps) — 5 args, returns HBITMAP
  (func $handle_CreateMappedBitmap (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $bitmap i32) (local $masked i32) (local $map i32) (local $map_count i32)
    (local.set $bitmap
      (call $host_gdi_load_bitmap
        (local.get $arg0)
        ;; Win98's export reads idBitmap as a WORD resource id even though the
        ;; modern prototype spells the slot INT_PTR.
        (i32.and (local.get $arg1) (i32.const 0xFFFF))))
    (if (local.get $bitmap)
      (then
        (if (local.get $arg3)
          (then
            ;; Translate the caller's COLORMAP array once, then walk it in
            ;; linear memory. The Win98 implementation clamps custom maps to
            ;; sixteen entries.
            (local.set $map (call $g2w (local.get $arg3)))
            (local.set $map_count (local.get $arg4)))
          (else (local.set $map_count (i32.const 6))))
        (call $mapped_bitmap_apply_colors
          (local.get $bitmap) (local.get $map) (local.get $map_count))
        (if (i32.ne (i32.and (local.get $arg2) (i32.const 2)) (i32.const 0))
          (then
            (local.set $masked (call $mapped_bitmap_create_masked (local.get $bitmap)))
            (drop (call $gdi_object_delete_full (local.get $bitmap)))
            (local.set $bitmap (local.get $masked))))))
    ;; Load failure is failure. Win98 returns NULL; fabricating a blank 16x16
    ;; bitmap hides missing resources and produces plausible empty toolbars.
    (global.set $eax (local.get $bitmap))
    (global.set $esp (i32.add (global.get $esp) (i32.const 24)))
  )

  ;; HPROPSHEETPAGE is an opaque, owned copy of PROPSHEETPAGEA. The handle
  ;; points at the copied public structure so WM_INITDIALOG can receive the
  ;; documented lParam; the two private words immediately before it retain the
  ;; live marker and exact extent. The heap header is another four bytes back.
  (global $PROPSHEET_PAGE_MAGIC i32 (i32.const 0x31475050)) ;; "PPG1"

  ;; Return the private header's wasm address, or zero for NULL, stale, foreign,
  ;; truncated, and forged handles. Translate the guest allocation only once.
  (func $propsheet_page_record (param $page i32) (result i32)
    (local $block i32) (local $block_w i32) (local $block_size i32)
    (local $raw_w i32) (local $size i32)
    (if (i32.or
          (i32.lt_u (local.get $page) (i32.const 12))
          (i32.ne (i32.and (local.get $page) (i32.const 7)) (i32.const 4)))
      (then (return (i32.const 0))))
    (local.set $block (i32.sub (local.get $page) (i32.const 12)))
    (if (i32.eqz (call $heap_arena_find (local.get $block)))
      (then (return (i32.const 0))))
    (local.set $block_w (call $g2w (local.get $block)))
    (local.set $block_size (i32.load (local.get $block_w)))
    (if (i32.or
          (i32.lt_u (local.get $block_size) (i32.const 56))
          (call $heap_block_bad (local.get $block) (local.get $block_size)))
      (then (return (i32.const 0))))
    (local.set $raw_w (i32.add (local.get $block_w) (i32.const 4)))
    (if (i32.ne (i32.load (local.get $raw_w)) (global.get $PROPSHEET_PAGE_MAGIC))
      (then (return (i32.const 0))))
    (local.set $size (i32.load offset=4 (local.get $raw_w)))
    (if (i32.or
          (i32.or (i32.lt_u (local.get $size) (i32.const 40))
                  (i32.gt_u (local.get $size) (i32.const 0x1000)))
          (i32.gt_u (local.get $size)
            (i32.sub (local.get $block_size) (i32.const 12))))
      (then (return (i32.const 0))))
    (local.get $raw_w))

  ;; Invoke a page callback as the real three-argument stdcall. This mirrors the
  ;; bounded synchronous guest-call path used by EDITSTREAM and SendMessage:
  ;; preserve every interrupted x86 register, enter through the existing sync
  ;; return thunk, and restore the caller after the callback reaches it.
  (func $propsheet_page_callback
      (param $page i32) (param $psp_w i32) (param $message i32) (result i32)
    (local $callback i32) (local $result i32) (local $rounds i32)
    (local $old_eip i32) (local $old_esp i32) (local $old_eax i32)
    (local $old_ecx i32) (local $old_edx i32) (local $old_ebx i32)
    (local $old_esi i32) (local $old_edi i32) (local $old_ebp i32)
    (local $old_handler_set_eip i32) (local $old_steps i32)
    (local $old_yield_reason i32) (local $old_yield_flag i32)
    (if (i32.eqz
          (i32.and (i32.load offset=4 (local.get $psp_w)) (i32.const 0x80)))
      (then (return (i32.const 1))))
    (local.set $callback (i32.load offset=32 (local.get $psp_w)))
    (if (i32.eqz (local.get $callback)) (then (return (i32.const 1))))
    (local.set $old_eip (global.get $eip))
    (local.set $old_esp (global.get $esp))
    (local.set $old_eax (global.get $eax))
    (local.set $old_ecx (global.get $ecx))
    (local.set $old_edx (global.get $edx))
    (local.set $old_ebx (global.get $ebx))
    (local.set $old_esi (global.get $esi))
    (local.set $old_edi (global.get $edi))
    (local.set $old_ebp (global.get $ebp))
    (local.set $old_handler_set_eip (global.get $handler_set_eip))
    (local.set $old_steps (global.get $steps))
    (local.set $old_yield_reason (global.get $yield_reason))
    (local.set $old_yield_flag (global.get $yield_flag))
    ;; Push right-to-left: ppsp, PSPCB_*, NULL hwnd, return thunk.
    (global.set $esp (i32.sub (global.get $esp) (i32.const 4)))
    (call $gs32 (global.get $esp) (local.get $page))
    (global.set $esp (i32.sub (global.get $esp) (i32.const 4)))
    (call $gs32 (global.get $esp) (local.get $message))
    (global.set $esp (i32.sub (global.get $esp) (i32.const 4)))
    (call $gs32 (global.get $esp) (i32.const 0))
    (global.set $esp (i32.sub (global.get $esp) (i32.const 4)))
    (call $gs32 (global.get $esp) (global.get $sync_msg_ret_thunk))
    (global.set $eip (local.get $callback))
    (global.set $steps (i32.const 0))
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $sync_msg_depth
      (i32.add (global.get $sync_msg_depth) (i32.const 1)))
    (block $done (loop $run_callback
      (call $run (i32.const 1000000))
      (br_if $done (i32.eqz (global.get $eip)))
      (local.set $rounds (i32.add (local.get $rounds) (i32.const 1)))
      (br_if $done (i32.ge_u (local.get $rounds) (i32.const 64)))
      (br $run_callback)))
    (global.set $sync_msg_depth
      (i32.sub (global.get $sync_msg_depth) (i32.const 1)))
    ;; A callback that fails to reach the return thunk cannot safely approve a
    ;; page. PSPCB_RELEASE ignores the result, but uses the same bounded call.
    (local.set $result
      (select (global.get $eax) (i32.const 0) (i32.eqz (global.get $eip))))
    (global.set $eip (local.get $old_eip))
    (global.set $esp (local.get $old_esp))
    (global.set $eax (local.get $old_eax))
    (global.set $ecx (local.get $old_ecx))
    (global.set $edx (local.get $old_edx))
    (global.set $ebx (local.get $old_ebx))
    (global.set $esi (local.get $old_esi))
    (global.set $edi (local.get $old_edi))
    (global.set $ebp (local.get $old_ebp))
    (global.set $handler_set_eip (local.get $old_handler_set_eip))
    (global.set $steps (local.get $old_steps))
    (global.set $yield_reason (local.get $old_yield_reason))
    (global.set $yield_flag (local.get $old_yield_flag))
    (local.get $result))

  (func $propsheet_page_ref_change
      (param $psp_w i32) (param $delta i32)
    (local $ref_g i32) (local $ref_w i32)
    (if (i32.eqz
          (i32.and (i32.load offset=4 (local.get $psp_w)) (i32.const 0x40)))
      (then (return)))
    (local.set $ref_g (i32.load offset=36 (local.get $psp_w)))
    (if (i32.eqz (local.get $ref_g)) (then (return)))
    (local.set $ref_w (call $g2w (local.get $ref_g)))
    (i32.store (local.get $ref_w)
      (i32.add (i32.load (local.get $ref_w)) (local.get $delta))))

  (func $propsheet_page_destroy_owned (param $page i32) (result i32)
    (local $raw_w i32) (local $psp_w i32)
    (local.set $raw_w (call $propsheet_page_record (local.get $page)))
    (if (i32.eqz (local.get $raw_w)) (then (return (i32.const 0))))
    ;; Retire the handle before PSPCB_RELEASE so a callback that recursively
    ;; calls DestroyPropertySheetPage cannot enter itself or double-free.
    (i32.store (local.get $raw_w) (i32.const 0x52475050)) ;; "PPGR"
    (local.set $psp_w (i32.add (local.get $raw_w) (i32.const 8)))
    (drop (call $propsheet_page_callback
      (local.get $page) (local.get $psp_w) (i32.const 1))) ;; PSPCB_RELEASE
    ;; Win98 delivers RELEASE first, then balances PSP_USEREFPARENT.
    (call $propsheet_page_ref_change (local.get $psp_w) (i32.const -1))
    (i32.store (local.get $raw_w) (i32.const 0))
    (i32.store offset=4 (local.get $raw_w) (i32.const 0))
    (call $heap_free (i32.sub (local.get $page) (i32.const 8)))
    (i32.const 1))

  ;; CreatePropertySheetPageA(lppsp) — 1 arg, returns HPROPSHEETPAGE.
  ;; Win98 accepts 40..4096-byte structures and rejects flag bits above bit 15.
  ;; On the Win98 path, structures newer than the 40-byte base receive the
  ;; return-ignored PSPCB_ADDREF here. PSPCB_CREATE belongs to page-dialog
  ;; materialization, and PSPCB_RELEASE is delivered exactly once on teardown.
  (func $handle_CreatePropertySheetPageA (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $src_w i32) (local $size i32) (local $flags i32)
    (local $raw i32) (local $raw_w i32)
    (if (i32.eqz (local.get $arg0))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $src_w (call $g2w (local.get $arg0)))
    (local.set $size (i32.load (local.get $src_w)))
    (local.set $flags (i32.load offset=4 (local.get $src_w)))
    (if (i32.or
          (i32.or (i32.lt_u (local.get $size) (i32.const 40))
                  (i32.gt_u (local.get $size) (i32.const 0x1000)))
          (i32.ne (i32.and (local.get $flags) (i32.const 0xFFFF0000)) (i32.const 0)))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $raw (call $heap_alloc (i32.add (local.get $size) (i32.const 8))))
    (if (i32.eqz (local.get $raw))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $raw_w (call $g2w (local.get $raw)))
    (i32.store (local.get $raw_w) (global.get $PROPSHEET_PAGE_MAGIC))
    (i32.store offset=4 (local.get $raw_w) (local.get $size))
    (memory.copy (i32.add (local.get $raw_w) (i32.const 8))
      (local.get $src_w) (local.get $size))
    (local.set $arg0 (i32.add (local.get $raw) (i32.const 8)))
    ;; Match Win98's ordering by incrementing the optional parent reference
    ;; after allocation succeeds and before the optional ADDREF callback.
    (call $propsheet_page_ref_change
      (i32.add (local.get $raw_w) (i32.const 8)) (i32.const 1))
    ;; Win98 sends PSPCB_ADDREF only for records larger than its 40-byte base.
    (if (i32.gt_u (local.get $size) (i32.const 40))
      (then
        (drop (call $propsheet_page_callback
          (local.get $arg0) (i32.add (local.get $raw_w) (i32.const 8))
          (i32.const 0))))) ;; PSPCB_ADDREF
    ;; A reentrant callback may have destroyed the handle itself.
    (if (i32.eqz (call $propsheet_page_record (local.get $arg0)))
      (then (local.set $arg0 (i32.const 0))))
    (global.set $eax (local.get $arg0))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8))))

  ;; DestroyPropertySheetPage(hPSPage) — 1 arg, returns BOOL.
  (func $handle_DestroyPropertySheetPage (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (global.set $eax (call $propsheet_page_destroy_owned (local.get $arg0)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; PropertySheetA(lppsph) — 1 arg, returns int (>0 if user clicked OK).
  ;; The frame and guest-backed pages are built by the USER control layer;
  ;; park this synchronous API on the same modal pump as the common dialogs.
  (func $handle_PropertySheetA (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $dlg i32)
    (if (i32.eqz (local.get $arg0))
      (then
        (global.set $eax (i32.const -1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (call $modal_capture_nonvolatile)
    (local.set $dlg (call $create_property_sheet (local.get $arg0)))
    (if (i32.eqz (local.get $dlg))
      (then
        (global.set $modal_restore_pending (i32.const 0))
        (global.set $eax (i32.const -1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (call $modal_begin (local.get $dlg) (i32.const 8))
  )

  ;; ImageList_SetBkColor(himl, clrBk) — 2 args, returns old bk color
  (func $handle_ImageList_SetBkColor (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $old i32) (local $bk_wa i32)
    (if (i32.eqz (local.get $arg0))
      (then
        (global.set $eax (i32.const -1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $bk_wa (call $g2w (i32.add (local.get $arg0) (i32.const 8))))
    (local.set $old (i32.load (local.get $bk_wa)))
    (i32.store (local.get $bk_wa) (local.get $arg1))
    (global.set $eax (local.get $old))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; ImageList_GetBkColor(himl) — 1 arg
  (func $handle_ImageList_GetBkColor (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (if (i32.eqz (local.get $arg0))
      (then
        (global.set $eax (i32.const -1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (global.set $eax (i32.load (call $g2w (i32.add (local.get $arg0) (i32.const 8)))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; CreateStatusWindowW — same as A version, 4 args
  (func $handle_CreateStatusWindowW (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; The renderer string bridge is ANSI; the app sets status text later via
    ;; messages, so create the Unicode control with an initially empty title.
    (global.set $eax (call $create_status_window
      (local.get $arg0) (i32.const 0) (local.get $arg2) (local.get $arg3)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 20)))
  )

  ;; ============================================================
  ;; COMCTL32 internal heap functions (ordinal-only)
  ;; Win98 comctl32.dll ordinals 71..74 are thin wrappers over HeapAlloc with
  ;; HEAP_ZERO_MEMORY, HeapReAlloc with HEAP_ZERO_MEMORY, HeapFree, and HeapSize
  ;; respectively.  Keep that contract here; only the private heap's storage
  ;; representation differs inside the browser runtime.
  ;; ============================================================

  ;; Keep the allocator's private size/liveness header immediately before the
  ;; pointer exposed to common-control callers:
  ;;   heap payload [magic:4, requested_size:4, caller bytes...]
  ;; The underlying heap header remains four bytes before that payload.  This
  ;; gives GetSize the requested extent and lets Free/ReAlloc reject stale or
  ;; foreign pointers without guessing from adjacent guest memory.
  (global $COMCTL_ALLOC_MAGIC i32 (i32.const 0x31414343)) ;; "CCA1"

  ;; Return the private header's wasm address, or zero when pv is not one of
  ;; this family's live allocations.  The guest pointer is translated once.
  (func $comctl_alloc_record (param $ptr i32) (result i32)
    (local $block i32) (local $block_wa i32) (local $block_size i32)
    (local $raw_wa i32) (local $requested i32)
    (if (i32.or
          (i32.lt_u (local.get $ptr) (i32.const 12))
          (i32.ne (i32.and (local.get $ptr) (i32.const 7)) (i32.const 4)))
      (then (return (i32.const 0))))
    (local.set $block (i32.sub (local.get $ptr) (i32.const 12)))
    (if (i32.eqz (call $heap_arena_find (local.get $block)))
      (then (return (i32.const 0))))
    (local.set $block_wa (call $g2w (local.get $block)))
    (local.set $block_size (i32.load (local.get $block_wa)))
    (if (i32.or
          (i32.lt_u (local.get $block_size) (i32.const 16))
          (call $heap_block_bad (local.get $block) (local.get $block_size)))
      (then (return (i32.const 0))))
    (local.set $raw_wa (i32.add (local.get $block_wa) (i32.const 4)))
    (if (i32.ne (i32.load (local.get $raw_wa)) (global.get $COMCTL_ALLOC_MAGIC))
      (then (return (i32.const 0))))
    (local.set $requested (i32.load offset=4 (local.get $raw_wa)))
    (if (i32.gt_u (local.get $requested)
          (i32.sub (local.get $block_size) (i32.const 12)))
      (then (return (i32.const 0))))
    (local.get $raw_wa))

  (func $comctl_alloc_new (param $size i32) (result i32)
    (local $raw i32) (local $raw_wa i32)
    (if (i32.gt_u (local.get $size) (i32.const 0x7FFFFFE8))
      (then (return (i32.const 0))))
    (local.set $raw
      (call $heap_alloc (i32.add (local.get $size) (i32.const 8))))
    (if (i32.eqz (local.get $raw)) (then (return (i32.const 0))))
    (local.set $raw_wa (call $g2w (local.get $raw)))
    (i32.store (local.get $raw_wa) (global.get $COMCTL_ALLOC_MAGIC))
    (i32.store offset=4 (local.get $raw_wa) (local.get $size))
    (if (local.get $size)
      (then
        (memory.fill (i32.add (local.get $raw_wa) (i32.const 8))
          (i32.const 0) (local.get $size))))
    (i32.add (local.get $raw) (i32.const 8)))

  ;; Comctl32_Alloc(dwSize) — 1 arg, returns pointer (zeroed)
  (func $handle_Comctl32_Alloc (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (global.set $eax (call $comctl_alloc_new (local.get $arg0)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; Comctl32_ReAlloc(pv, cbNew) — 2 args, returns pointer
  (func $handle_Comctl32_ReAlloc (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $old_wa i32) (local $old_size i32)
    (local $new_raw i32) (local $new_wa i32)
    (if (i32.eqz (local.get $arg0))
      (then
        (global.set $eax (call $comctl_alloc_new (local.get $arg1)))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $old_wa (call $comctl_alloc_record (local.get $arg0)))
    (if (i32.or
          (i32.eqz (local.get $old_wa))
          (i32.gt_u (local.get $arg1) (i32.const 0x7FFFFFE8)))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $old_size (i32.load offset=4 (local.get $old_wa)))
    (local.set $new_raw
      (call $heap_realloc
        (i32.sub (local.get $arg0) (i32.const 8))
        (i32.add (local.get $arg1) (i32.const 8))
        (i32.const 0)))
    (if (i32.eqz (local.get $new_raw))
      (then
        ;; The original allocation remains live when reallocation fails.
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $new_wa (call $g2w (local.get $new_raw)))
    (i32.store (local.get $new_wa) (global.get $COMCTL_ALLOC_MAGIC))
    (i32.store offset=4 (local.get $new_wa) (local.get $arg1))
    (if (i32.gt_u (local.get $arg1) (local.get $old_size))
      (then
        (memory.fill
          (i32.add (local.get $new_wa)
            (i32.add (i32.const 8) (local.get $old_size)))
          (i32.const 0)
          (i32.sub (local.get $arg1) (local.get $old_size)))))
    (global.set $eax (i32.add (local.get $new_raw) (i32.const 8)))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; Comctl32_Free(pv) — 1 arg, returns BOOL
  (func $handle_Comctl32_Free (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $raw_wa i32)
    (local.set $raw_wa (call $comctl_alloc_record (local.get $arg0)))
    (if (i32.eqz (local.get $raw_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (i32.store (local.get $raw_wa) (i32.const 0))
    (i32.store offset=4 (local.get $raw_wa) (i32.const 0))
    (call $heap_free (i32.sub (local.get $arg0) (i32.const 8)))
    (global.set $eax (i32.const 1))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; Comctl32_GetSize(pv) — 1 arg, returns DWORD size
  (func $handle_Comctl32_GetSize (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $raw_wa i32)
    (local.set $raw_wa (call $comctl_alloc_record (local.get $arg0)))
    (if (local.get $raw_wa)
      (then (global.set $eax (i32.load offset=4 (local.get $raw_wa))))
      (else (global.set $eax (i32.const -1))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; ============================================================
  ;; DSA/DPA handles are opaque heap objects.  Keep a live marker outside the
  ;; legacy fields so every operation can reject NULL and already-destroyed
  ;; handles before translating or dereferencing them.  The marker is cleared
  ;; before the block is returned to the heap; heap_free then overwrites only
  ;; the first payload word with its next link.
  (global $DSA_MAGIC i32 (i32.const 0x31415344)) ;; "DSA1"
  (global $DPA_MAGIC i32 (i32.const 0x31415044)) ;; "DPA1"

  (func $dsa_record (param $hdsa i32) (result i32)
    (local $wa i32) (local $block i32) (local $size i32)
    (if (i32.or
          (i32.eqz (local.get $hdsa))
          (i32.ne (i32.and (local.get $hdsa) (i32.const 7)) (i32.const 4)))
      (then (return (i32.const 0))))
    (local.set $block (i32.sub (local.get $hdsa) (i32.const 4)))
    (if (i32.eqz (call $heap_arena_find (local.get $block)))
      (then (return (i32.const 0))))
    (local.set $size (i32.load (call $g2w (local.get $block))))
    (if (i32.or
          (i32.lt_u (local.get $size) (i32.const 24))
          (call $heap_block_bad (local.get $block) (local.get $size)))
      (then (return (i32.const 0))))
    (local.set $wa (call $g2w (local.get $hdsa)))
    (if (i32.ne (i32.load offset=16 (local.get $wa)) (global.get $DSA_MAGIC))
      (then (return (i32.const 0))))
    (local.get $wa))

  (func $dpa_record (param $hdpa i32) (result i32)
    (local $wa i32) (local $block i32) (local $size i32)
    (if (i32.or
          (i32.eqz (local.get $hdpa))
          (i32.ne (i32.and (local.get $hdpa) (i32.const 7)) (i32.const 4)))
      (then (return (i32.const 0))))
    (local.set $block (i32.sub (local.get $hdpa) (i32.const 4)))
    (if (i32.eqz (call $heap_arena_find (local.get $block)))
      (then (return (i32.const 0))))
    (local.set $size (i32.load (call $g2w (local.get $block))))
    (if (i32.or
          (i32.lt_u (local.get $size) (i32.const 24))
          (call $heap_block_bad (local.get $block) (local.get $size)))
      (then (return (i32.const 0))))
    (local.set $wa (call $g2w (local.get $hdpa)))
    (if (i32.ne (i32.load offset=12 (local.get $wa)) (global.get $DPA_MAGIC))
      (then (return (i32.const 0))))
    (local.get $wa))

  ;; DSA (Dynamic Structure Array) — real implementation
  ;; DSA layout in memory:
  ;; [item_size:4, count:4, capacity:4, data_ptr:4, live_magic:4]
  ;; ============================================================

  ;; DSA_Create(cbItem, cItemGrow) — 2 args, returns HDSA
  (func $handle_DSA_Create (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $dsa i32) (local $dsa_wa i32)
    (local $cap i32) (local $data i32)
    (local.set $cap
      (select (local.get $arg1) (i32.const 8)
        (i32.gt_s (local.get $arg1) (i32.const 0))))
    ;; cbItem is a positive byte count, and the initial backing multiplication
    ;; must stay within the heap allocator's documented maximum request.
    (if (i32.le_s (local.get $arg0) (i32.const 0))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (if (i32.gt_u (local.get $cap)
          (i32.div_u (i32.const 0x7FFFFFF0) (local.get $arg0)))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $dsa (call $heap_alloc (i32.const 20)))
    (if (i32.eqz (local.get $dsa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $data (call $heap_alloc (i32.mul (local.get $cap) (local.get $arg0))))
    (if (i32.eqz (local.get $data))
      (then
        (call $heap_free (local.get $dsa))
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $dsa_wa (call $g2w (local.get $dsa)))
    (i32.store (local.get $dsa_wa) (local.get $arg0))           ;; item_size
    (i32.store offset=4 (local.get $dsa_wa) (i32.const 0))  ;; count
    (i32.store offset=8 (local.get $dsa_wa) (local.get $cap))  ;; capacity
    (i32.store offset=12 (local.get $dsa_wa) (local.get $data))
    (i32.store offset=16 (local.get $dsa_wa) (global.get $DSA_MAGIC))
    (global.set $eax (local.get $dsa))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; DSA_Destroy(hdsa) — 1 arg, returns BOOL
  (func $handle_DSA_Destroy (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $dsa_wa i32) (local $data i32)
    (local.set $dsa_wa (call $dsa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dsa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $data (i32.load offset=12 (local.get $dsa_wa)))
    ;; Retire first, then release backing storage and finally the handle.
    (i32.store offset=12 (local.get $dsa_wa) (i32.const 0))
    (i32.store offset=16 (local.get $dsa_wa) (i32.const 0))
    (call $heap_free (local.get $data))
    (call $heap_free (local.get $arg0))
    (global.set $eax (i32.const 1))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; DSA_GetItem(hdsa, index, pitem) — 3 args, returns BOOL
  (func $handle_DSA_GetItem (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $item_size i32) (local $dsa_wa i32)
    (local $data_ptr i32) (local $data_wa i32) (local $item_wa i32)
    (local $count i32)
    (local.set $dsa_wa (call $dsa_record (local.get $arg0)))
    (if (i32.or (i32.eqz (local.get $dsa_wa)) (i32.eqz (local.get $arg2)))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $item_size (i32.load (local.get $dsa_wa)))
    (local.set $count (i32.load offset=4 (local.get $dsa_wa)))
    (local.set $data_ptr (i32.load offset=12 (local.get $dsa_wa)))
    (if (i32.lt_u (local.get $arg1) (local.get $count))
      (then
        (local.set $data_wa (call $g2w (local.get $data_ptr)))
        (local.set $item_wa (call $g2w (local.get $arg2)))
        ;; Copy item_size bytes from data[index*item_size] to pitem
        (memory.copy (local.get $item_wa)
          (i32.add (local.get $data_wa) (i32.mul (local.get $arg1) (local.get $item_size)))
          (local.get $item_size))
        (global.set $eax (i32.const 1)))
      (else
        (global.set $eax (i32.const 0))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; DSA_GetItemPtr(hdsa, index) — 2 args, returns pointer to item
  (func $handle_DSA_GetItemPtr (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $item_size i32) (local $dsa_wa i32)
    (local $data_ptr i32)
    (local $count i32)
    (local.set $dsa_wa (call $dsa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dsa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $item_size (i32.load (local.get $dsa_wa)))
    (local.set $count (i32.load offset=4 (local.get $dsa_wa)))
    (local.set $data_ptr (i32.load offset=12 (local.get $dsa_wa)))
    (if (i32.lt_u (local.get $arg1) (local.get $count))
      (then
        (global.set $eax (i32.add (local.get $data_ptr) (i32.mul (local.get $arg1) (local.get $item_size)))))
      (else
        (global.set $eax (i32.const 0))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; DSA_InsertItem(hdsa, index, pitem) — 3 args, returns index or -1
  ;; Callers index a DSA in lockstep with a parallel list control — Task
  ;; Manager reads row N of its listbox and asks the DSA for item N — so an
  ;; insert in the middle has to move the later items up rather than overwrite
  ;; the one already there, and has to grow the buffer instead of running off
  ;; the end of it once the initial capacity fills.
  (func $handle_DSA_InsertItem (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $item_size i32) (local $dsa_wa i32) (local $data_wa i32)
    (local $count i32)
    (local $cap i32)
    (local $data_ptr i32)
    (local $idx i32)
    (local $new_cap i32)
    (local $new_data i32) (local $new_data_wa i32) (local $item_wa i32)
    (local.set $dsa_wa (call $dsa_record (local.get $arg0)))
    (if (i32.or (i32.eqz (local.get $dsa_wa)) (i32.eqz (local.get $arg2)))
      (then
        (global.set $eax (i32.const -1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $item_size (i32.load (local.get $dsa_wa)))
    (local.set $count (i32.load offset=4 (local.get $dsa_wa)))
    (local.set $cap (i32.load offset=8 (local.get $dsa_wa)))
    (local.set $data_ptr (i32.load offset=12 (local.get $dsa_wa))) (local.set $data_wa (call $g2w (local.get $data_ptr)))
    ;; Clamp index: if index > count or DA_LAST (0x7FFFFFFF), append
    (local.set $idx (select (local.get $count) (local.get $arg1)
      (i32.gt_u (local.get $arg1) (local.get $count))))
    ;; Grow first so the extra slot exists before the shift.
    (if (i32.ge_u (local.get $count) (local.get $cap))
      (then
        (if (i32.gt_u (local.get $cap) (i32.const 0x3FFFFFFF))
          (then
            (global.set $eax (i32.const -1))
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))
        (local.set $new_cap (i32.shl (local.get $cap) (i32.const 1)))
        (if (i32.lt_u (local.get $new_cap) (i32.const 8))
          (then (local.set $new_cap (i32.const 8))))
        (if (i32.gt_u (local.get $new_cap)
              (i32.div_u (i32.const 0x7FFFFFF0) (local.get $item_size)))
          (then
            (global.set $eax (i32.const -1))
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))
        (local.set $new_data
          (call $heap_alloc (i32.mul (local.get $new_cap) (local.get $item_size))))
        (if (i32.eqz (local.get $new_data))
          (then
            (global.set $eax (i32.const -1))
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))
        (local.set $new_data_wa (call $g2w (local.get $new_data)))
        (if (local.get $count)
          (then
            (memory.copy (local.get $new_data_wa) (local.get $data_wa)
              (i32.mul (local.get $count) (local.get $item_size)))))
        (if (local.get $data_ptr) (then (call $heap_free (local.get $data_ptr))))
        (local.set $data_ptr (local.get $new_data)) (local.set $data_wa (local.get $new_data_wa))
        (i32.store offset=8 (local.get $dsa_wa) (local.get $new_cap))
        (i32.store offset=12 (local.get $dsa_wa) (local.get $new_data))))
    ;; Shift [idx, count) up one slot. memory.copy is defined to behave like
    ;; memmove, so the overlap here is safe.
    (if (i32.gt_u (local.get $count) (local.get $idx))
      (then
        (memory.copy
          (i32.add (local.get $data_wa)
            (i32.mul (i32.add (local.get $idx) (i32.const 1)) (local.get $item_size)))
          (i32.add (local.get $data_wa) (i32.mul (local.get $idx) (local.get $item_size)))
          (i32.mul (i32.sub (local.get $count) (local.get $idx)) (local.get $item_size)))))
    ;; Copy item data to data[idx * item_size]
    (local.set $item_wa (call $g2w (local.get $arg2)))
    (memory.copy
      (i32.add (local.get $data_wa) (i32.mul (local.get $idx) (local.get $item_size)))
      (local.get $item_wa)
      (local.get $item_size))
    ;; Increment count
    (i32.store offset=4 (local.get $dsa_wa)
      (i32.add (local.get $count) (i32.const 1)))
    (global.set $eax (local.get $idx))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; DSA_DeleteItem(hdsa, index) — 2 args, returns BOOL
  ;; Removing item N must close the gap. Only decrementing the count drops the
  ;; LAST item logically while every index from N on still reads its old
  ;; neighbour — which is how Task Manager's End Task came to act on the row
  ;; above the one the user had selected.
  (func $handle_DSA_DeleteItem (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $item_size i32) (local $dsa_wa i32) (local $data_wa i32)
    (local $count i32)
    (local $data_ptr i32)
    (local.set $dsa_wa (call $dsa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dsa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $item_size (i32.load (local.get $dsa_wa)))
    (local.set $count (i32.load offset=4 (local.get $dsa_wa)))
    (local.set $data_ptr (i32.load offset=12 (local.get $dsa_wa))) (local.set $data_wa (call $g2w (local.get $data_ptr)))
    (if (i32.lt_u (local.get $arg1) (local.get $count))
      (then
        ;; Shift (index, count) down over the removed slot.
        (if (i32.gt_u (i32.sub (local.get $count) (i32.const 1)) (local.get $arg1))
          (then
            (memory.copy
              (i32.add (local.get $data_wa) (i32.mul (local.get $arg1) (local.get $item_size)))
              (i32.add (local.get $data_wa)
                (i32.mul (i32.add (local.get $arg1) (i32.const 1)) (local.get $item_size)))
              (i32.mul (i32.sub (i32.sub (local.get $count) (i32.const 1)) (local.get $arg1))
                (local.get $item_size)))))
        (i32.store offset=4 (local.get $dsa_wa)
          (i32.sub (local.get $count) (i32.const 1)))
        (global.set $eax (i32.const 1)))
      (else
        (global.set $eax (i32.const 0))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; ============================================================
  ;; DPA (Dynamic Pointer Array) — real implementation
  ;; DPA layout: [count:4, capacity:4, ptrs_ptr:4, live_magic:4]
  ;; ============================================================

  ;; DPA_Create(cItemGrow) — 1 arg, returns HDPA
  (func $handle_DPA_Create (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $dpa i32) (local $dpa_wa i32)
    (local $cap i32) (local $ptrs i32)
    (local.set $cap
      (select (local.get $arg0) (i32.const 8)
        (i32.gt_s (local.get $arg0) (i32.const 0))))
    (if (i32.gt_u (local.get $cap) (i32.const 0x1FFFFFFC))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $dpa (call $heap_alloc (i32.const 16)))
    (if (i32.eqz (local.get $dpa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $ptrs (call $heap_alloc (i32.shl (local.get $cap) (i32.const 2))))
    (if (i32.eqz (local.get $ptrs))
      (then
        (call $heap_free (local.get $dpa))
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $dpa_wa (call $g2w (local.get $dpa)))
    (i32.store (local.get $dpa_wa) (i32.const 0))           ;; count
    (i32.store offset=4 (local.get $dpa_wa) (local.get $cap))  ;; capacity
    (i32.store offset=8 (local.get $dpa_wa) (local.get $ptrs))
    (i32.store offset=12 (local.get $dpa_wa) (global.get $DPA_MAGIC))
    (global.set $eax (local.get $dpa))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; DPA_Destroy(hdpa) — 1 arg, returns BOOL
  (func $handle_DPA_Destroy (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $dpa_wa i32) (local $ptrs i32)
    (local.set $dpa_wa (call $dpa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dpa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (local.set $ptrs (i32.load offset=8 (local.get $dpa_wa)))
    (i32.store offset=8 (local.get $dpa_wa) (i32.const 0))
    (i32.store offset=12 (local.get $dpa_wa) (i32.const 0))
    (call $heap_free (local.get $ptrs))
    (call $heap_free (local.get $arg0))
    (global.set $eax (i32.const 1))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )

  ;; DPA_GetPtr(hdpa, index) — 2 args, returns pointer at index
  (func $handle_DPA_GetPtr (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $count i32) (local $dpa_wa i32)
    (local $ptrs i32)
    (local.set $dpa_wa (call $dpa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dpa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $count (i32.load (local.get $dpa_wa)))
    (local.set $ptrs (i32.load offset=8 (local.get $dpa_wa)))
    (if (i32.lt_u (local.get $arg1) (local.get $count))
      (then
        (global.set $eax (i32.load (call $g2w (i32.add (local.get $ptrs) (i32.shl (local.get $arg1) (i32.const 2)))))))
      (else
        (global.set $eax (i32.const 0))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; DPA_InsertPtr(hdpa, index, p) — 3 args, returns index or -1
  ;; A DPA is an ordered array, and callers index it in lockstep with a
  ;; parallel list control: Task Manager reads row N of its listbox and asks
  ;; the DPA for element N. So an insert must move the later elements up
  ;; rather than overwrite the one already at that slot, and must grow the
  ;; backing array instead of writing past it once the initial capacity fills.
  (func $handle_DPA_InsertPtr (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $count i32)
    (local $cap i32)
    (local $ptrs i32)
    (local $idx i32)
    (local $i i32)
    (local $new_cap i32)
    (local $new_ptrs i32)
    (local $dpa_wa i32) (local $ptrs_wa i32) (local $new_ptrs_wa i32)
    (local.set $dpa_wa (call $dpa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dpa_wa))
      (then
        (global.set $eax (i32.const -1))
        (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
        (return)))
    (local.set $count (i32.load (local.get $dpa_wa)))
    (local.set $cap (i32.load offset=4 (local.get $dpa_wa)))
    (local.set $ptrs (i32.load offset=8 (local.get $dpa_wa)))
    (if (local.get $ptrs)
      (then (local.set $ptrs_wa (call $g2w (local.get $ptrs)))))
    ;; DPA_APPEND (0x7FFFFFFF) and any out-of-range index append.
    (local.set $idx (select (local.get $count) (local.get $arg1)
      (i32.gt_u (local.get $arg1) (local.get $count))))
    ;; Grow before the shift so the extra slot exists.
    (if (i32.ge_u (local.get $count) (local.get $cap))
      (then
        (if (i32.gt_u (local.get $cap) (i32.const 0x0FFFFFFE))
          (then
            (global.set $eax (i32.const -1))
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))
        (local.set $new_cap (i32.shl (local.get $cap) (i32.const 1)))
        (if (i32.lt_u (local.get $new_cap) (i32.const 8))
          (then (local.set $new_cap (i32.const 8))))
        (local.set $new_ptrs (call $heap_alloc (i32.shl (local.get $new_cap) (i32.const 2))))
        (if (i32.eqz (local.get $new_ptrs))
          (then
            (global.set $eax (i32.const -1))
            (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
            (return)))
        (local.set $new_ptrs_wa (call $g2w (local.get $new_ptrs)))
        (local.set $i (i32.const 0))
        (block $copy_done (loop $copy
          (br_if $copy_done (i32.ge_u (local.get $i) (local.get $count)))
          (i32.store
            (i32.add (local.get $new_ptrs_wa) (i32.shl (local.get $i) (i32.const 2)))
            (i32.load (i32.add (local.get $ptrs_wa) (i32.shl (local.get $i) (i32.const 2)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $copy)))
        (if (local.get $ptrs) (then (call $heap_free (local.get $ptrs))))
        (local.set $ptrs (local.get $new_ptrs))
        (local.set $ptrs_wa (local.get $new_ptrs_wa))
        (i32.store offset=4 (local.get $dpa_wa) (local.get $new_cap))
        (i32.store offset=8 (local.get $dpa_wa) (local.get $new_ptrs))))
    ;; Shift [idx, count) up one slot, walking down so the copy cannot
    ;; overwrite a source it has not read yet.
    (local.set $i (local.get $count))
    (block $shift_done (loop $shift
      (br_if $shift_done (i32.le_u (local.get $i) (local.get $idx)))
      (i32.store
        (i32.add (local.get $ptrs_wa) (i32.shl (local.get $i) (i32.const 2)))
        (i32.load (i32.add (local.get $ptrs_wa)
          (i32.shl (i32.sub (local.get $i) (i32.const 1)) (i32.const 2)))))
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (br $shift)))
    (i32.store (i32.add (local.get $ptrs_wa) (i32.shl (local.get $idx) (i32.const 2)))
      (local.get $arg2))
    (i32.store (local.get $dpa_wa) (i32.add (local.get $count) (i32.const 1)))
    (global.set $eax (local.get $idx))
    (global.set $esp (i32.add (global.get $esp) (i32.const 16)))
  )

  ;; DPA_DeletePtr(hdpa, index) — 2 args, returns removed pointer
  ;; Removing element N must close the gap. Only decrementing the count
  ;; drops the LAST element logically while leaving every index from N on
  ;; pointing at its old record — which is how Task Manager's End Task came
  ;; to post WM_CLOSE to a window belonging to an app that had already quit.
  (func $handle_DPA_DeletePtr (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $count i32)
    (local $ptrs i32)
    (local $removed i32)
    (local $i i32)
    (local $dpa_wa i32) (local $ptrs_wa i32)
    (local.set $dpa_wa (call $dpa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dpa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
        (return)))
    (local.set $count (i32.load (local.get $dpa_wa)))
    (local.set $ptrs (i32.load offset=8 (local.get $dpa_wa)))
    (if (local.get $ptrs)
      (then (local.set $ptrs_wa (call $g2w (local.get $ptrs)))))
    (if (i32.lt_u (local.get $arg1) (local.get $count))
      (then
        (local.set $removed (i32.load (i32.add (local.get $ptrs_wa) (i32.shl (local.get $arg1) (i32.const 2)))))
        (local.set $i (local.get $arg1))
        (block $shift_done (loop $shift
          (br_if $shift_done (i32.ge_u (local.get $i) (i32.sub (local.get $count) (i32.const 1))))
          (i32.store
            (i32.add (local.get $ptrs_wa) (i32.shl (local.get $i) (i32.const 2)))
            (i32.load (i32.add (local.get $ptrs_wa)
              (i32.shl (i32.add (local.get $i) (i32.const 1)) (i32.const 2)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $shift)))
        (i32.store (local.get $dpa_wa) (i32.sub (local.get $count) (i32.const 1)))
        (global.set $eax (local.get $removed)))
      (else
        (global.set $eax (i32.const 0))))
    (global.set $esp (i32.add (global.get $esp) (i32.const 12)))
  )

  ;; DPA_DeleteAllPtrs(hdpa) — 1 arg, returns BOOL
  (func $handle_DPA_DeleteAllPtrs (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $dpa_wa i32)
    (local.set $dpa_wa (call $dpa_record (local.get $arg0)))
    (if (i32.eqz (local.get $dpa_wa))
      (then
        (global.set $eax (i32.const 0))
        (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
        (return)))
    (i32.store (local.get $dpa_wa) (i32.const 0))
    (global.set $eax (i32.const 1))
    (global.set $esp (i32.add (global.get $esp) (i32.const 8)))
  )
