  ;; ---- Installable Compression Manager (MSVFW32) ----------------------
  ;;
  ;; The decompressor half of Video for Windows: ICOpen/ICLocate/ICInfo/
  ;; ICGetInfo/ICSendMessage/ICDecompress/ICClose over the decoders in
  ;; 09a7e-video-codecs.wat. See docs/video-support-design.md.
  ;;
  ;; $VIDEO_ARENA layout:
  ;;   +0x0000  HIC table, $ICM_SLOTS records of 64 bytes
  ;;   +0x0400  ICINFO name strings
  ;;   +0x1000  one output row being converted (16 KB)
  ;;
  ;; HIC record:
  ;;   +0 open  +4 codec  +8 fccHandler  +12 mode
  ;;   +16 workspace wa  +20 workspace length
  ;;   +24 width  +28 height (positive)  +32 input bpp  +36 begun
  ;;   +40 Cinepak state wa  +44 index plane wa  +48 frame wa  +52 palette wa
  ;;   +56 gather wa  +60 gather capacity
  ;;
  ;; A workspace ($dib_alloc'd at DECOMPRESS_BEGIN) holds the input palette
  ;; (1 KB), the Cinepak codebooks, the retained index plane for 8-bit input,
  ;; the retained BGRX frame, so a delta frame paints over the previous picture
  ;; as the real codecs do, and room to gather a compressed frame whose guest
  ;; pages are not adjacent in WASM memory.
  (global $VIDEO_ARENA i32 (region.addr $VIDEO_ARENA 0))
  (global $VIDEO_ARENA_SIZE i32 (region.size $VIDEO_ARENA))
  (data (region.addr $VIDEO_ARENA 0x400) "Cinepak\00")
  (data (region.addr $VIDEO_ARENA 0x410) "Cinepak Codec by Radius\00")
  (data (region.addr $VIDEO_ARENA 0x440) "iccvid.drv\00")
  (data (region.addr $VIDEO_ARENA 0x450) "MS-RLE\00")
  (data (region.addr $VIDEO_ARENA 0x460) "Microsoft RLE\00")
  (data (region.addr $VIDEO_ARENA 0x470) "msrle32.dll\00")
  (global $ICM_SLOTS i32 (i32.const 8))
  (global $ICM_HANDLE_BASE i32 (i32.const 0x49430001))   ;; "IC" + slot + 1
  (global $ICM_ROW i32 (i32.const 0x1000))
  (global $ICM_ROW_BYTES i32 (i32.const 0x4000))

  ;; Internal codec ids.
  (global $ICM_CODEC_RAW i32 (i32.const 1))
  (global $ICM_CODEC_RLE8 i32 (i32.const 2))
  (global $ICM_CODEC_CVID i32 (i32.const 3))

  ;; fourccs, lower-cased with | 0x20202020.
  (global $FCC_VIDC i32 (i32.const 0x63646976))
  (global $FCC_CVID i32 (i32.const 0x64697663))
  (global $FCC_MRLE i32 (i32.const 0x656c726d))
  (global $FCC_RLE i32 (i32.const 0x20656c72))    ;; 'RLE '
  (global $FCC_RLE8 i32 (i32.const 0x38656c72))   ;; 'RLE8'
  (global $FCC_DIB i32 (i32.const 0x20626964))    ;; 'DIB '

  (global $ICERR_OK i32 (i32.const 0))
  (global $ICERR_UNSUPPORTED i32 (i32.const -1))
  (global $ICERR_BADFORMAT i32 (i32.const -2))
  (global $ICERR_MEMORY i32 (i32.const -3))
  (global $ICERR_BADPARAM i32 (i32.const -6))
  (global $ICERR_BADHANDLE i32 (i32.const -8))

  (func $icm_rec (param $slot i32) (result i32)
    (i32.add (global.get $VIDEO_ARENA) (i32.shl (local.get $slot) (i32.const 6))))

  ;; HIC → record address, or 0 for a handle that is not an open slot.
  (func $icm_rec_of (param $hic i32) (result i32)
    (local $slot i32) (local $rec i32)
    (local.set $slot (i32.sub (local.get $hic) (global.get $ICM_HANDLE_BASE)))
    (if (i32.ge_u (local.get $slot) (global.get $ICM_SLOTS)) (then (return (i32.const 0))))
    (local.set $rec (call $icm_rec (local.get $slot)))
    (if (i32.eqz (i32.load (local.get $rec))) (then (return (i32.const 0))))
    (local.get $rec))

  (func $icm_fcc_lower (param $fcc i32) (result i32)
    (i32.or (local.get $fcc) (i32.const 0x20202020)))

  ;; Which codec claims a handler fourcc (0 = none). Raw DIB is claimed only
  ;; by name: it is not an installed codec that ICInfo would enumerate.
  (func $icm_codec_for_handler (param $fcc i32) (result i32)
    (local $f i32)
    (local.set $f (call $icm_fcc_lower (local.get $fcc)))
    (if (i32.eq (local.get $f) (global.get $FCC_CVID)) (then (return (global.get $ICM_CODEC_CVID))))
    (if (i32.or (i32.eq (local.get $f) (global.get $FCC_MRLE))
          (i32.or (i32.eq (local.get $f) (global.get $FCC_RLE))
                  (i32.eq (local.get $f) (global.get $FCC_RLE8))))
      (then (return (global.get $ICM_CODEC_RLE8))))
    (if (i32.eq (local.get $f) (global.get $FCC_DIB)) (then (return (global.get $ICM_CODEC_RAW))))
    (i32.const 0))

  ;; Which codec decodes this input format (0 = none).
  (func $icm_codec_for_format (param $bi i32) (result i32)
    (local $c i32) (local $bpp i32)
    (if (i32.eqz (local.get $bi)) (then (return (i32.const 0))))
    (local.set $c (call $gl32 (i32.add (local.get $bi) (i32.const 16))))
    (local.set $bpp (call $gl16 (i32.add (local.get $bi) (i32.const 14))))
    (if (i32.eqz (local.get $c)) (then (return (global.get $ICM_CODEC_RAW))))
    (if (i32.and (i32.eq (local.get $c) (i32.const 1)) (i32.eq (local.get $bpp) (i32.const 8)))
      (then (return (global.get $ICM_CODEC_RLE8))))
    (if (i32.eq (call $icm_fcc_lower (local.get $c)) (global.get $FCC_CVID))
      (then (return (global.get $ICM_CODEC_CVID))))
    (i32.const 0))

  ;; Output layouts this layer writes: BI_RGB 8/16/24/32, or BI_BITFIELDS
  ;; 16 (555 or 565) and 32 (BGRX).
  (func $icm_out_ok (param $bo i32) (result i32)
    (local $bpp i32) (local $c i32) (local $w i32) (local $h i32)
    (local.set $bpp (call $gl16 (i32.add (local.get $bo) (i32.const 14))))
    (local.set $c (call $gl32 (i32.add (local.get $bo) (i32.const 16))))
    (local.set $w (call $gl32 (i32.add (local.get $bo) (i32.const 4))))
    (local.set $h (call $tt_abs (call $gl32 (i32.add (local.get $bo) (i32.const 8)))))
    (if (i32.or (i32.le_s (local.get $w) (i32.const 0))
          (i32.or (i32.eqz (local.get $h)) (i32.gt_u (local.get $w) (i32.const 4096))))
      (then (return (i32.const 0))))
    (if (i32.eqz (local.get $c))
      (then (return (i32.or (i32.or (i32.eq (local.get $bpp) (i32.const 8)) (i32.eq (local.get $bpp) (i32.const 16)))
                            (i32.or (i32.eq (local.get $bpp) (i32.const 24)) (i32.eq (local.get $bpp) (i32.const 32)))))))
    (if (i32.eq (local.get $c) (i32.const 3))
      (then (return (i32.or (i32.eq (local.get $bpp) (i32.const 16)) (i32.eq (local.get $bpp) (i32.const 32))))))
    (i32.const 0))

  ;; ICM_DECOMPRESS_QUERY for one codec. $bo may be NULL ("can you decode
  ;; this at all").
  (func $icm_query (param $codec i32) (param $bi i32) (param $bo i32) (result i32)
    (local $w i32) (local $h i32) (local $bpp i32)
    (if (i32.eqz (local.get $bi)) (then (return (global.get $ICERR_BADFORMAT))))
    (if (i32.ne (call $icm_codec_for_format (local.get $bi)) (local.get $codec))
      (then (return (global.get $ICERR_BADFORMAT))))
    (local.set $w (call $gl32 (i32.add (local.get $bi) (i32.const 4))))
    (local.set $h (call $tt_abs (call $gl32 (i32.add (local.get $bi) (i32.const 8)))))
    (local.set $bpp (call $gl16 (i32.add (local.get $bi) (i32.const 14))))
    (if (i32.or (i32.le_s (local.get $w) (i32.const 0))
          (i32.or (i32.eqz (local.get $h))
            (i32.or (i32.gt_u (local.get $w) (i32.const 2048)) (i32.gt_u (local.get $h) (i32.const 2048)))))
      (then (return (global.get $ICERR_BADFORMAT))))
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_RAW))
      (then
        (if (i32.eqz (i32.or (i32.or (i32.eq (local.get $bpp) (i32.const 8)) (i32.eq (local.get $bpp) (i32.const 16)))
                             (i32.or (i32.eq (local.get $bpp) (i32.const 24)) (i32.eq (local.get $bpp) (i32.const 32)))))
          (then (return (global.get $ICERR_BADFORMAT))))))
    ;; Cinepak's palettized grey variant is not decoded.
    (if (i32.and (i32.eq (local.get $codec) (global.get $ICM_CODEC_CVID))
                 (i32.eq (local.get $bpp) (i32.const 8)))
      (then (return (global.get $ICERR_BADFORMAT))))
    (if (i32.and (i32.ne (local.get $bo) (i32.const 0))
                 (i32.eqz (call $icm_out_ok (local.get $bo))))
      (then (return (global.get $ICERR_BADFORMAT))))
    (global.get $ICERR_OK))

  (func $icm_default_out_bpp (param $codec i32) (param $bi i32) (result i32)
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_CVID)) (then (return (i32.const 24))))
    (call $gl16 (i32.add (local.get $bi) (i32.const 14))))

  ;; ICM_DECOMPRESS_GET_FORMAT: with $bo NULL the size of the format; else
  ;; the codec's preferred output (24 bpp for Cinepak, the input depth
  ;; otherwise, 8-bit carrying the input palette).
  (func $icm_get_format (param $codec i32) (param $bi i32) (param $bo i32) (result i32)
    (local $bpp i32) (local $w i32) (local $h i32) (local $i i32) (local $isz i32)
    (if (i32.ne (call $icm_query (local.get $codec) (local.get $bi) (i32.const 0)) (i32.const 0))
      (then (return (global.get $ICERR_BADFORMAT))))
    (local.set $bpp (call $icm_default_out_bpp (local.get $codec) (local.get $bi)))
    (if (i32.eqz (local.get $bo))
      (then (return (select (i32.const 1064) (i32.const 40) (i32.eq (local.get $bpp) (i32.const 8))))))
    (local.set $w (call $gl32 (i32.add (local.get $bi) (i32.const 4))))
    (local.set $h (call $tt_abs (call $gl32 (i32.add (local.get $bi) (i32.const 8)))))
    (call $gs32 (local.get $bo) (i32.const 40))
    (call $gs32 (i32.add (local.get $bo) (i32.const 4)) (local.get $w))
    (call $gs32 (i32.add (local.get $bo) (i32.const 8)) (local.get $h))
    (call $gs16 (i32.add (local.get $bo) (i32.const 12)) (i32.const 1))
    (call $gs16 (i32.add (local.get $bo) (i32.const 14)) (local.get $bpp))
    (call $gs32 (i32.add (local.get $bo) (i32.const 16)) (i32.const 0))
    (call $gs32 (i32.add (local.get $bo) (i32.const 20))
      (i32.mul (call $icm_stride (local.get $w) (local.get $bpp)) (local.get $h)))
    (call $gs32 (i32.add (local.get $bo) (i32.const 24)) (i32.const 0))
    (call $gs32 (i32.add (local.get $bo) (i32.const 28)) (i32.const 0))
    (call $gs32 (i32.add (local.get $bo) (i32.const 32))
      (select (i32.const 256) (i32.const 0) (i32.eq (local.get $bpp) (i32.const 8))))
    (call $gs32 (i32.add (local.get $bo) (i32.const 36)) (i32.const 0))
    (if (i32.eq (local.get $bpp) (i32.const 8))
      (then
        (local.set $isz (call $gl32 (local.get $bi)))
        (block $done (loop $copy
          (br_if $done (i32.ge_u (local.get $i) (i32.const 1024)))
          (call $gs32 (i32.add (local.get $bo) (i32.add (i32.const 40) (local.get $i)))
            (if (result i32) (i32.lt_u (local.get $i)
                   (i32.shl (call $icm_in_colors (local.get $bi)) (i32.const 2)))
              (then (call $gl32 (i32.add (local.get $bi) (i32.add (local.get $isz) (local.get $i)))))
              (else (i32.const 0))))
          (local.set $i (i32.add (local.get $i) (i32.const 4)))
          (br $copy)))))
    (global.get $ICERR_OK))

  (func $icm_stride (param $w i32) (param $bpp i32) (result i32)
    (i32.shl (i32.shr_u (i32.add (i32.mul (local.get $w) (local.get $bpp)) (i32.const 31)) (i32.const 5)) (i32.const 2)))

  ;; Colour-table entries an 8-bit input format carries.
  (func $icm_in_colors (param $bi i32) (result i32)
    (local $n i32)
    (if (i32.gt_u (call $gl16 (i32.add (local.get $bi) (i32.const 14))) (i32.const 8))
      (then (return (i32.const 0))))
    (local.set $n (call $gl32 (i32.add (local.get $bi) (i32.const 32))))
    (if (i32.or (i32.eqz (local.get $n)) (i32.gt_u (local.get $n) (i32.const 256)))
      (then (local.set $n (i32.const 256))))
    (local.get $n))

  ;; ---- 8-bit output palette for true-colour codecs --------------------
  ;; A 6x7x6 colour cube (252 entries, the rest black) with a 4x4 ordered
  ;; dither. The app asks for it with ICM_DECOMPRESS_GET_PALETTE and
  ;; realizes it before the first frame, as War Wind does.
  (func $icm_cube_entry (param $i i32) (result i32)
    (if (i32.ge_u (local.get $i) (i32.const 252)) (then (return (i32.const 0))))
    (i32.or (i32.or
      (i32.shl (i32.div_u (i32.mul (i32.div_u (local.get $i) (i32.const 42)) (i32.const 255)) (i32.const 5)) (i32.const 16))
      (i32.shl (i32.div_u (i32.mul (i32.rem_u (i32.div_u (local.get $i) (i32.const 6)) (i32.const 7)) (i32.const 255)) (i32.const 6)) (i32.const 8)))
      (i32.div_u (i32.mul (i32.rem_u (local.get $i) (i32.const 6)) (i32.const 255)) (i32.const 5))))

  ;; 4x4 Bayer threshold 0..15.
  (func $icm_bayer (param $x i32) (param $y i32) (result i32)
    (local $d i32)
    (local.set $d (i32.xor (local.get $x) (local.get $y)))
    (i32.or (i32.or (i32.shl (i32.and (local.get $d) (i32.const 1)) (i32.const 3))
                    (i32.shl (i32.and (local.get $y) (i32.const 1)) (i32.const 2)))
            (i32.or (i32.and (local.get $d) (i32.const 2))
                    (i32.shr_u (i32.and (local.get $y) (i32.const 2)) (i32.const 1)))))

  (func $icm_dither_level (param $v i32) (param $levels i32) (param $t i32) (result i32)
    (local $q i32)
    (local.set $q (i32.div_u
      (i32.add (i32.mul (i32.mul (local.get $v) (i32.sub (local.get $levels) (i32.const 1))) (i32.const 16))
               (i32.add (i32.mul (local.get $t) (i32.const 255)) (i32.const 127)))
      (i32.const 4080)))
    (select (i32.sub (local.get $levels) (i32.const 1)) (local.get $q)
      (i32.ge_u (local.get $q) (local.get $levels))))

  (func $icm_dither (param $c i32) (param $x i32) (param $y i32) (result i32)
    (local $t i32)
    (local.set $t (call $icm_bayer (i32.and (local.get $x) (i32.const 3)) (i32.and (local.get $y) (i32.const 3))))
    (i32.add (i32.add
      (i32.mul (call $icm_dither_level (i32.and (i32.shr_u (local.get $c) (i32.const 16)) (i32.const 255)) (i32.const 6) (local.get $t)) (i32.const 42))
      (i32.mul (call $icm_dither_level (i32.and (i32.shr_u (local.get $c) (i32.const 8)) (i32.const 255)) (i32.const 7) (local.get $t)) (i32.const 6)))
      (call $icm_dither_level (i32.and (local.get $c) (i32.const 255)) (i32.const 6) (local.get $t))))

  ;; ICM_DECOMPRESS_GET_PALETTE: the colour table 8-bit output will use,
  ;; written after lpbiOut's header.
  (func $icm_get_palette (param $rec i32) (param $bi i32) (param $bo i32) (result i32)
    (local $codec i32) (local $i i32) (local $at i32) (local $n i32) (local $isz i32)
    (if (i32.eqz (local.get $bo)) (then (return (global.get $ICERR_BADPARAM))))
    (local.set $codec (i32.load offset=4 (local.get $rec)))
    (if (i32.eqz (local.get $bi)) (then (local.set $bi (local.get $bo))))
    (if (i32.ne (call $icm_query (local.get $codec) (local.get $bi) (i32.const 0)) (i32.const 0))
      (then (return (global.get $ICERR_BADFORMAT))))
    (local.set $at (i32.add (local.get $bo) (call $gl32 (local.get $bo))))
    (local.set $n (call $icm_in_colors (local.get $bi)))
    (local.set $isz (call $gl32 (local.get $bi)))
    (block $done (loop $entry
      (br_if $done (i32.ge_u (local.get $i) (i32.const 256)))
      (call $gs32 (i32.add (local.get $at) (i32.shl (local.get $i) (i32.const 2)))
        (if (result i32) (local.get $n)
          (then (if (result i32) (i32.lt_u (local.get $i) (local.get $n))
                  (then (call $gl32 (i32.add (i32.add (local.get $bi) (local.get $isz)) (i32.shl (local.get $i) (i32.const 2)))))
                  (else (i32.const 0))))
          (else (call $icm_cube_entry (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $entry)))
    (call $gs32 (i32.add (local.get $bo) (i32.const 32)) (i32.const 256))
    (global.get $ICERR_OK))

  ;; ---- workspace allocation -------------------------------------------
  ;; Workspaces come from the DIB arena: page-aligned, linear in WASM memory
  ;; and zeroed, and frame-sized, which is the arena's business.
  (func $icm_ws_release (param $rec i32)
    (if (i32.load offset=16 (local.get $rec))
      (then (call $dib_free_wasm (i32.load offset=16 (local.get $rec)))))
    (i32.store offset=16 (local.get $rec) (i32.const 0))
    (i32.store offset=20 (local.get $rec) (i32.const 0)))

  ;; ICM_DECOMPRESS_BEGIN: validate, size and clear the workspace.
  (func $icm_begin (param $rec i32) (param $bi i32) (param $bo i32) (result i32)
    (local $codec i32) (local $w i32) (local $h i32) (local $px i32)
    (local $len i32) (local $ga i32) (local $base i32) (local $p i32)
    (local.set $codec (i32.load offset=4 (local.get $rec)))
    (if (i32.ne (call $icm_query (local.get $codec) (local.get $bi) (local.get $bo)) (i32.const 0))
      (then (return (global.get $ICERR_BADFORMAT))))
    (local.set $w (call $gl32 (i32.add (local.get $bi) (i32.const 4))))
    (local.set $h (call $tt_abs (call $gl32 (i32.add (local.get $bi) (i32.const 8)))))
    (local.set $px (i32.mul (local.get $w) (local.get $h)))
    ;; palette | Cinepak books | index plane | frame | gather
    ;; The gather area holds one compressed frame whose guest pages are not
    ;; adjacent in WASM memory; no frame of these formats outgrows 32 bpp.
    (local.set $len (i32.add (i32.const 1024)
      (i32.add (select (global.get $VID_CVID_STATE_SIZE) (i32.const 0)
                 (i32.eq (local.get $codec) (global.get $ICM_CODEC_CVID)))
        (i32.add (i32.and (i32.add (local.get $px) (i32.const 15)) (i32.const -16))
                 (i32.add (i32.shl (local.get $px) (i32.const 3)) (i32.const 0x1000))))))
    ;; Reuse the workspace a previous BEGIN sized, when it is big enough.
    (if (i32.lt_u (i32.load offset=20 (local.get $rec)) (local.get $len))
      (then
        (call $icm_ws_release (local.get $rec))
        (local.set $ga (call $dib_alloc (local.get $len)))
        (if (i32.eqz (local.get $ga)) (then (return (global.get $ICERR_MEMORY))))
        (i32.store offset=16 (local.get $rec)
          (i32.add (global.get $DIB_BACKING_BASE) (i32.sub (local.get $ga) (global.get $DIB_GUEST_BASE))))
        (i32.store offset=20 (local.get $rec) (local.get $len))))
    (local.set $base (i32.load offset=16 (local.get $rec)))
    (call $zero_memory (local.get $base) (local.get $len))
    (i32.store offset=52 (local.get $rec) (local.get $base))
    (local.set $p (i32.add (local.get $base) (i32.const 1024)))
    (i32.store offset=40 (local.get $rec) (local.get $p))
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_CVID))
      (then (local.set $p (i32.add (local.get $p) (global.get $VID_CVID_STATE_SIZE)))))
    (i32.store offset=44 (local.get $rec) (local.get $p))
    (local.set $p (i32.add (local.get $p) (i32.and (i32.add (local.get $px) (i32.const 15)) (i32.const -16))))
    (i32.store offset=48 (local.get $rec) (local.get $p))
    (local.set $p (i32.add (local.get $p) (i32.shl (local.get $px) (i32.const 2))))
    (i32.store offset=56 (local.get $rec) (local.get $p))
    (i32.store offset=60 (local.get $rec) (i32.add (i32.shl (local.get $px) (i32.const 2)) (i32.const 0x1000)))
    (i32.store offset=24 (local.get $rec) (local.get $w))
    (i32.store offset=28 (local.get $rec) (local.get $h))
    (i32.store offset=32 (local.get $rec) (call $gl16 (i32.add (local.get $bi) (i32.const 14))))
    (i32.store offset=36 (local.get $rec) (i32.const 1))
    (global.get $ICERR_OK))

  ;; A compressed frame as one linear WASM block: the direct translation when
  ;; its pages are adjacent, otherwise gathered into the workspace. 0 = too big.
  (func $icm_gather (param $rec i32) (param $ga i32) (param $len i32) (result i32)
    (local $wa i32) (local $dst i32) (local $i i32)
    (local.set $wa (call $g2w_affine_span (local.get $ga) (local.get $len)))
    (if (i32.ne (local.get $wa) (global.get $NULL_SENTINEL)) (then (return (local.get $wa))))
    (if (i32.gt_u (local.get $len) (i32.load offset=60 (local.get $rec))) (then (return (i32.const 0))))
    (local.set $dst (i32.load offset=56 (local.get $rec)))
    (block $done (loop $copy
      (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
      (i32.store8 (i32.add (local.get $dst) (local.get $i))
        (call $gl8 (i32.add (local.get $ga) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $copy)))
    (local.get $dst))

  (func $icm_put_guest (param $ga i32) (param $src i32) (param $len i32)
    (local $wa i32) (local $i i32)
    (local.set $wa (call $g2w_affine_span (local.get $ga) (local.get $len)))
    (if (i32.ne (local.get $wa) (global.get $NULL_SENTINEL))
      (then (memory.copy (local.get $wa) (local.get $src) (local.get $len)) (return)))
    (block $done (loop $copy
      (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
      (call $gs8 (i32.add (local.get $ga) (local.get $i))
        (i32.load8_u (i32.add (local.get $src) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $copy))))

  ;; Decode one compressed frame into the workspace. $len 0 (a drop frame)
  ;; leaves the retained picture.
  (func $icm_decode (param $rec i32) (param $bi i32) (param $data i32) (param $len i32) (result i32)
    (local $codec i32) (local $src i32) (local $w i32) (local $h i32)
    (local $pal i32) (local $plane i32) (local $frame i32) (local $n i32) (local $i i32)
    (local $bpp i32) (local $stride i32) (local $y i32) (local $row i32)
    (local.set $codec (i32.load offset=4 (local.get $rec)))
    (local.set $w (i32.load offset=24 (local.get $rec)))
    (local.set $h (i32.load offset=28 (local.get $rec)))
    (local.set $pal (i32.load offset=52 (local.get $rec)))
    (local.set $plane (i32.load offset=44 (local.get $rec)))
    (local.set $frame (i32.load offset=48 (local.get $rec)))
    (local.set $bpp (i32.load offset=32 (local.get $rec)))
    ;; 8-bit input: the colour table travels with every frame's format, which
    ;; is how AVI palette changes reach a decompressor.
    (if (i32.eq (local.get $bpp) (i32.const 8))
      (then
        (local.set $n (call $icm_in_colors (local.get $bi)))
        (local.set $i (i32.const 0))
        (block $done (loop $copy
          (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
          (i32.store (i32.add (local.get $pal) (i32.shl (local.get $i) (i32.const 2)))
            (call $gl32 (i32.add (i32.add (local.get $bi) (call $gl32 (local.get $bi)))
                                 (i32.shl (local.get $i) (i32.const 2)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $copy)))))
    (if (i32.or (i32.eqz (local.get $data)) (i32.eqz (local.get $len)))
      (then (return (global.get $ICERR_OK))))
    (local.set $src (call $icm_gather (local.get $rec) (local.get $data) (local.get $len)))
    (if (i32.eqz (local.get $src)) (then (return (global.get $ICERR_BADPARAM))))
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_CVID))
      (then
        (drop (call $vid_cvid_decode (i32.load offset=40 (local.get $rec)) (local.get $src) (local.get $len)
          (local.get $frame) (local.get $w) (local.get $h)))
        (return (global.get $ICERR_OK))))
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_RLE8))
      (then
        (call $vid_rle8_decode (local.get $plane) (local.get $src) (local.get $len) (local.get $w) (local.get $h))
        (call $vid_index_to_bgrx (local.get $plane) (local.get $pal) (local.get $frame)
          (i32.mul (local.get $w) (local.get $h)))
        (return (global.get $ICERR_OK))))
    ;; Raw 8-bit keeps its indices too, so 8-bit output stays exact.
    (if (i32.eq (local.get $bpp) (i32.const 8))
      (then
        (local.set $stride (call $icm_stride (local.get $w) (i32.const 8)))
        (block $done (loop $rows
          (br_if $done (i32.ge_u (local.get $y) (local.get $h)))
          (local.set $row (i32.mul (local.get $stride)
            (select (local.get $y) (i32.sub (i32.sub (local.get $h) (i32.const 1)) (local.get $y))
              (i32.lt_s (call $gl32 (i32.add (local.get $bi) (i32.const 8))) (i32.const 0)))))
          (br_if $done (i32.gt_u (i32.add (local.get $row) (local.get $w)) (local.get $len)))
          (memory.copy (i32.add (local.get $plane) (i32.mul (local.get $y) (local.get $w)))
            (i32.add (local.get $src) (local.get $row)) (local.get $w))
          (local.set $y (i32.add (local.get $y) (i32.const 1)))
          (br $rows)))
        (call $vid_index_to_bgrx (local.get $plane) (local.get $pal) (local.get $frame)
          (i32.mul (local.get $w) (local.get $h)))
        (return (global.get $ICERR_OK))))
    (call $vid_raw_decode (local.get $src) (local.get $len) (local.get $pal) (local.get $bpp)
      (local.get $w) (local.get $h)
      (i32.lt_s (call $gl32 (i32.add (local.get $bi) (i32.const 8))) (i32.const 0))
      (local.get $frame))
    (global.get $ICERR_OK))

  ;; How many bytes of compressed data a frame holds: biSizeImage, or for a
  ;; writer that left it 0, the Cinepak frame header's own length.
  (func $icm_input_len (param $rec i32) (param $bi i32) (param $data i32) (result i32)
    (local $n i32)
    (if (i32.eqz (local.get $data)) (then (return (i32.const 0))))
    ;; A Cinepak frame states its own length, and that is what the driver
    ;; trusts: callers pass one format for a whole movie (Dark Colony's
    ;; biSizeImage is a fixed 0x6018), so biSizeImage says nothing per frame.
    (if (i32.eq (i32.load offset=4 (local.get $rec)) (global.get $ICM_CODEC_CVID))
      (then (return (i32.or (i32.or
        (i32.shl (call $gl8 (i32.add (local.get $data) (i32.const 1))) (i32.const 16))
        (i32.shl (call $gl8 (i32.add (local.get $data) (i32.const 2))) (i32.const 8)))
        (call $gl8 (i32.add (local.get $data) (i32.const 3)))))))
    (local.set $n (call $gl32 (i32.add (local.get $bi) (i32.const 20))))
    (if (local.get $n) (then (return (local.get $n))))
    (i32.mul (call $icm_stride (i32.load offset=24 (local.get $rec)) (i32.load offset=32 (local.get $rec)))
             (i32.load offset=28 (local.get $rec))))

  ;; Write the retained picture into the caller's DIB: source rectangle
  ;; (xs,ys,dxs,dys) of the frame onto destination rectangle (xd,yd,dxd,dyd),
  ;; nearest-neighbour stretched, both measured from the top of the picture.
  (func $icm_output (param $rec i32) (param $bo i32) (param $out i32)
                    (param $xd i32) (param $yd i32) (param $dxd i32) (param $dyd i32)
                    (param $xs i32) (param $ys i32) (param $dxs i32) (param $dys i32)
    (local $ow i32) (local $oh i32) (local $obpp i32) (local $stride i32) (local $bytes i32)
    (local $w i32) (local $h i32) (local $frame i32) (local $plane i32) (local $indexed i32)
    (local $is565 i32) (local $row i32) (local $x i32) (local $y i32) (local $sx i32) (local $sy i32)
    (local $c i32) (local $v i32) (local $dy_mem i32) (local $o i32) (local $px i32)
    (local.set $ow (call $gl32 (i32.add (local.get $bo) (i32.const 4))))
    (local.set $oh (call $gl32 (i32.add (local.get $bo) (i32.const 8))))
    (local.set $obpp (call $gl16 (i32.add (local.get $bo) (i32.const 14))))
    (local.set $stride (call $icm_stride (local.get $ow) (local.get $obpp)))
    (local.set $w (i32.load offset=24 (local.get $rec)))
    (local.set $h (i32.load offset=28 (local.get $rec)))
    (local.set $frame (i32.load offset=48 (local.get $rec)))
    (local.set $plane (i32.load offset=44 (local.get $rec)))
    ;; 8-bit in, 8-bit out: the indices themselves, palette untouched.
    (local.set $indexed (i32.and (i32.eq (i32.load offset=32 (local.get $rec)) (i32.const 8))
                                 (i32.eq (local.get $obpp) (i32.const 8))))
    (local.set $is565 (i32.and
      (i32.eq (call $gl32 (i32.add (local.get $bo) (i32.const 16))) (i32.const 3))
      (i32.eq (call $gl32 (i32.add (local.get $bo) (i32.const 40))) (i32.const 0xF800))))
    (local.set $row (i32.add (global.get $VIDEO_ARENA) (global.get $ICM_ROW)))
    ;; Clip the destination to the output bitmap; a clipped column keeps
    ;; sampling the source it would have used.
    (if (i32.lt_s (local.get $xd) (i32.const 0)) (then (local.set $xd (i32.const 0))))
    (if (i32.lt_s (local.get $yd) (i32.const 0)) (then (local.set $yd (i32.const 0))))
    (if (i32.gt_s (i32.add (local.get $xd) (local.get $dxd)) (local.get $ow))
      (then (local.set $dxd (i32.sub (local.get $ow) (local.get $xd)))))
    (if (i32.gt_s (i32.add (local.get $yd) (local.get $dyd)) (call $tt_abs (local.get $oh)))
      (then (local.set $dyd (i32.sub (call $tt_abs (local.get $oh)) (local.get $yd)))))
    (if (i32.or (i32.le_s (local.get $dxd) (i32.const 0))
          (i32.or (i32.le_s (local.get $dyd) (i32.const 0))
            (i32.or (i32.le_s (local.get $dxs) (i32.const 0)) (i32.le_s (local.get $dys) (i32.const 0)))))
      (then (return)))
    (local.set $bytes (i32.shr_u (i32.mul (local.get $dxd) (local.get $obpp)) (i32.const 3)))
    (if (i32.gt_u (local.get $bytes) (global.get $ICM_ROW_BYTES)) (then (return)))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_s (local.get $y) (local.get $dyd)))
      (local.set $sy (i32.add (local.get $ys)
        (i32.div_s (i32.mul (local.get $y) (local.get $dys)) (local.get $dyd))))
      (if (i32.ge_u (local.get $sy) (local.get $h))
        (then (local.set $sy (i32.sub (local.get $h) (i32.const 1)))))
      (local.set $x (i32.const 0))
      (local.set $o (local.get $row))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_s (local.get $x) (local.get $dxd)))
        (local.set $sx (i32.add (local.get $xs)
          (i32.div_s (i32.mul (local.get $x) (local.get $dxs)) (local.get $dxd))))
        (if (i32.ge_u (local.get $sx) (local.get $w))
          (then (local.set $sx (i32.sub (local.get $w) (i32.const 1)))))
        (local.set $px (i32.add (i32.mul (local.get $sy) (local.get $w)) (local.get $sx)))
        (local.set $c (i32.load (i32.add (local.get $frame) (i32.shl (local.get $px) (i32.const 2)))))
        (if (i32.eq (local.get $obpp) (i32.const 8))
          (then
            (i32.store8 (local.get $o)
              (if (result i32) (local.get $indexed)
                (then (i32.load8_u (i32.add (local.get $plane) (local.get $px))))
                (else (call $icm_dither (local.get $c)
                        (i32.add (local.get $xd) (local.get $x)) (i32.add (local.get $yd) (local.get $y))))))
            (local.set $o (i32.add (local.get $o) (i32.const 1)))))
        (if (i32.eq (local.get $obpp) (i32.const 16))
          (then
            (local.set $v (if (result i32) (local.get $is565)
              (then (i32.or (i32.or
                (i32.shl (i32.shr_u (i32.and (local.get $c) (i32.const 0xFF0000)) (i32.const 19)) (i32.const 11))
                (i32.shl (i32.shr_u (i32.and (local.get $c) (i32.const 0xFF00)) (i32.const 10)) (i32.const 5)))
                (i32.shr_u (i32.and (local.get $c) (i32.const 0xFF)) (i32.const 3))))
              (else (i32.or (i32.or
                (i32.shl (i32.shr_u (i32.and (local.get $c) (i32.const 0xFF0000)) (i32.const 19)) (i32.const 10))
                (i32.shl (i32.shr_u (i32.and (local.get $c) (i32.const 0xFF00)) (i32.const 11)) (i32.const 5)))
                (i32.shr_u (i32.and (local.get $c) (i32.const 0xFF)) (i32.const 3))))))
            (i32.store16 (local.get $o) (local.get $v))
            (local.set $o (i32.add (local.get $o) (i32.const 2)))))
        (if (i32.eq (local.get $obpp) (i32.const 24))
          (then
            (i32.store16 (local.get $o) (local.get $c))
            (i32.store8 offset=2 (local.get $o) (i32.shr_u (local.get $c) (i32.const 16)))
            (local.set $o (i32.add (local.get $o) (i32.const 3)))))
        (if (i32.eq (local.get $obpp) (i32.const 32))
          (then
            (i32.store (local.get $o) (local.get $c))
            (local.set $o (i32.add (local.get $o) (i32.const 4)))))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $cols)))
      ;; A positive biHeight is a bottom-up DIB.
      (local.set $dy_mem (i32.add (local.get $yd) (local.get $y)))
      (if (i32.gt_s (local.get $oh) (i32.const 0))
        (then (local.set $dy_mem (i32.sub (i32.sub (local.get $oh) (i32.const 1)) (local.get $dy_mem)))))
      (call $icm_put_guest
        (i32.add (local.get $out)
          (i32.add (i32.mul (local.get $dy_mem) (local.get $stride))
                   (i32.shr_u (i32.mul (local.get $xd) (local.get $obpp)) (i32.const 3))))
        (local.get $row) (local.get $bytes))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $rows))))

  ;; One frame, full picture to full output: ICM_DECOMPRESS / ICDecompress.
  (func $icm_decompress (param $rec i32) (param $flags i32) (param $bi i32) (param $data i32)
                        (param $bo i32) (param $out i32) (result i32)
    (local $r i32)
    (if (i32.or (i32.eqz (local.get $bi)) (i32.eqz (local.get $bo)))
      (then (return (global.get $ICERR_BADPARAM))))
    ;; Lenient about a missing BEGIN, as the Cinepak driver is.
    (if (i32.eqz (i32.load offset=36 (local.get $rec)))
      (then
        (local.set $r (call $icm_begin (local.get $rec) (local.get $bi) (local.get $bo)))
        (if (local.get $r) (then (return (local.get $r))))))
    (local.set $r (call $icm_decode (local.get $rec) (local.get $bi) (local.get $data)
      (call $icm_input_len (local.get $rec) (local.get $bi) (local.get $data))))
    (if (local.get $r) (then (return (local.get $r))))
    ;; ICDECOMPRESS_HURRYUP: keep the state current, skip the picture.
    (if (i32.and (local.get $flags) (i32.const 0x80000000)) (then (return (global.get $ICERR_OK))))
    (if (local.get $out)
      (then (call $icm_output (local.get $rec) (local.get $bo) (local.get $out)
        (i32.const 0) (i32.const 0)
        (call $gl32 (i32.add (local.get $bo) (i32.const 4)))
        (call $tt_abs (call $gl32 (i32.add (local.get $bo) (i32.const 8))))
        (i32.const 0) (i32.const 0)
        (i32.load offset=24 (local.get $rec)) (i32.load offset=28 (local.get $rec)))))
    (global.get $ICERR_OK))

  ;; ICDECOMPRESSEX {flags, lpbiSrc, lpSrc, lpbiDst, lpDst,
  ;;                 xDst, yDst, dxDst, dyDst, xSrc, ySrc, dxSrc, dySrc}
  (func $icm_decompress_ex (param $rec i32) (param $p i32) (result i32)
    (local $bi i32) (local $bo i32) (local $r i32) (local $out i32)
    (local.set $bi (call $gl32 (i32.add (local.get $p) (i32.const 4))))
    (local.set $bo (call $gl32 (i32.add (local.get $p) (i32.const 12))))
    (if (i32.or (i32.eqz (local.get $bi)) (i32.eqz (local.get $bo)))
      (then (return (global.get $ICERR_BADPARAM))))
    (if (i32.eqz (i32.load offset=36 (local.get $rec)))
      (then
        (local.set $r (call $icm_begin (local.get $rec) (local.get $bi) (local.get $bo)))
        (if (local.get $r) (then (return (local.get $r))))))
    (local.set $r (call $icm_decode (local.get $rec) (local.get $bi)
      (call $gl32 (i32.add (local.get $p) (i32.const 8)))
      (call $icm_input_len (local.get $rec) (local.get $bi) (call $gl32 (i32.add (local.get $p) (i32.const 8))))))
    (if (local.get $r) (then (return (local.get $r))))
    (if (i32.and (call $gl32 (local.get $p)) (i32.const 0x80000000)) (then (return (global.get $ICERR_OK))))
    (local.set $out (call $gl32 (i32.add (local.get $p) (i32.const 16))))
    (if (local.get $out)
      (then (call $icm_output (local.get $rec) (local.get $bo) (local.get $out)
        (call $gl32 (i32.add (local.get $p) (i32.const 20))) (call $gl32 (i32.add (local.get $p) (i32.const 24)))
        (call $gl32 (i32.add (local.get $p) (i32.const 28))) (call $gl32 (i32.add (local.get $p) (i32.const 32)))
        (call $gl32 (i32.add (local.get $p) (i32.const 36))) (call $gl32 (i32.add (local.get $p) (i32.const 40)))
        (call $gl32 (i32.add (local.get $p) (i32.const 44))) (call $gl32 (i32.add (local.get $p) (i32.const 48))))))
    (global.get $ICERR_OK))

  ;; ---- ICINFO ---------------------------------------------------------
  ;; {dwSize, fccType, fccHandler, dwFlags, dwVersion, dwVersionICM,
  ;;  WCHAR szName[16], szDescription[128], szDriver[128]} = 568 bytes.
  (func $icm_put_wstr (param $ga i32) (param $s i32) (param $max i32)
    (local $i i32) (local $c i32)
    (block $done (loop $copy
      (br_if $done (i32.ge_u (local.get $i) (i32.sub (local.get $max) (i32.const 1))))
      (local.set $c (i32.load8_u (i32.add (local.get $s) (local.get $i))))
      (br_if $done (i32.eqz (local.get $c)))
      (call $gs16 (i32.add (local.get $ga) (i32.shl (local.get $i) (i32.const 1))) (local.get $c))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $copy)))
    (call $gs16 (i32.add (local.get $ga) (i32.shl (local.get $i) (i32.const 1))) (i32.const 0)))

  (func $icm_fill_info (param $codec i32) (param $ga i32) (param $cb i32) (result i32)
    (local $i i32)
    (if (i32.or (i32.eqz (local.get $ga)) (i32.lt_u (local.get $cb) (i32.const 568)))
      (then (return (i32.const 0))))
    (block $z (loop $clear
      (br_if $z (i32.ge_u (local.get $i) (i32.const 568)))
      (call $gs32 (i32.add (local.get $ga) (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $clear)))
    (call $gs32 (local.get $ga) (i32.const 568))
    (call $gs32 (i32.add (local.get $ga) (i32.const 4)) (global.get $FCC_VIDC))
    (call $gs32 (i32.add (local.get $ga) (i32.const 20)) (i32.const 0x104))
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_CVID))
      (then
        (call $gs32 (i32.add (local.get $ga) (i32.const 8)) (global.get $FCC_CVID))
        (call $gs32 (i32.add (local.get $ga) (i32.const 12)) (i32.const 0x0A))   ;; VIDCF_QUALITY | VIDCF_TEMPORAL
        (call $gs32 (i32.add (local.get $ga) (i32.const 16)) (i32.const 0x00010001))
        (call $icm_put_wstr (i32.add (local.get $ga) (i32.const 24)) (region.addr $VIDEO_ARENA 0x400) (i32.const 16))
        (call $icm_put_wstr (i32.add (local.get $ga) (i32.const 56)) (region.addr $VIDEO_ARENA 0x410) (i32.const 128))
        (call $icm_put_wstr (i32.add (local.get $ga) (i32.const 312)) (region.addr $VIDEO_ARENA 0x440) (i32.const 128))))
    (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_RLE8))
      (then
        (call $gs32 (i32.add (local.get $ga) (i32.const 8)) (global.get $FCC_MRLE))
        (call $gs32 (i32.add (local.get $ga) (i32.const 12)) (i32.const 0x08))   ;; VIDCF_TEMPORAL
        (call $gs32 (i32.add (local.get $ga) (i32.const 16)) (i32.const 0x00010000))
        (call $icm_put_wstr (i32.add (local.get $ga) (i32.const 24)) (region.addr $VIDEO_ARENA 0x450) (i32.const 16))
        (call $icm_put_wstr (i32.add (local.get $ga) (i32.const 56)) (region.addr $VIDEO_ARENA 0x460) (i32.const 128))
        (call $icm_put_wstr (i32.add (local.get $ga) (i32.const 312)) (region.addr $VIDEO_ARENA 0x470) (i32.const 128))))
    (i32.const 568))

  ;; ---- open / close ---------------------------------------------------
  (func $icm_open_codec (param $codec i32) (param $fcc i32) (param $mode i32) (result i32)
    (local $slot i32) (local $rec i32)
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $slot) (global.get $ICM_SLOTS)))
      (local.set $rec (call $icm_rec (local.get $slot)))
      (if (i32.eqz (i32.load (local.get $rec)))
        (then
          (i64.store (local.get $rec) (i64.const 0))
          (i64.store offset=8 (local.get $rec) (i64.const 0))
          (i64.store offset=16 (local.get $rec) (i64.const 0))
          (i64.store offset=24 (local.get $rec) (i64.const 0))
          (i64.store offset=32 (local.get $rec) (i64.const 0))
          (i64.store offset=40 (local.get $rec) (i64.const 0))
          (i64.store offset=48 (local.get $rec) (i64.const 0))
          (i64.store offset=56 (local.get $rec) (i64.const 0))
          (i32.store offset=4 (local.get $rec) (local.get $codec))
          (i32.store offset=8 (local.get $rec) (local.get $fcc))
          (i32.store offset=12 (local.get $rec) (local.get $mode))
          (i32.store (local.get $rec) (i32.const 1))
          (return (i32.add (global.get $ICM_HANDLE_BASE) (local.get $slot)))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 1)))
      (br $scan)))
    (i32.const 0))

  ;; ICMODE_DECOMPRESS 2, ICMODE_FASTDECOMPRESS 3, ICMODE_QUERY 4. There are
  ;; no compressors and no draw handlers.
  (func $icm_mode_ok (param $mode i32) (result i32)
    (i32.and (i32.ge_u (local.get $mode) (i32.const 2)) (i32.le_u (local.get $mode) (i32.const 4))))

  (func $icm_type_ok (param $fcc i32) (result i32)
    (i32.or (i32.eqz (local.get $fcc))
            (i32.eq (call $icm_fcc_lower (local.get $fcc)) (global.get $FCC_VIDC))))

  ;; ICSendMessage's message switch.
  (func $icm_message (param $rec i32) (param $msg i32) (param $p1 i32) (param $p2 i32) (result i32)
    (local $codec i32)
    (local.set $codec (i32.load offset=4 (local.get $rec)))
    (if (i32.eq (local.get $msg) (i32.const 0x400B))   ;; DECOMPRESS_QUERY
      (then (return (call $icm_query (local.get $codec) (local.get $p1) (local.get $p2)))))
    (if (i32.eq (local.get $msg) (i32.const 0x400A))   ;; DECOMPRESS_GET_FORMAT
      (then (return (call $icm_get_format (local.get $codec) (local.get $p1) (local.get $p2)))))
    (if (i32.eq (local.get $msg) (i32.const 0x400C))   ;; DECOMPRESS_BEGIN
      (then (return (call $icm_begin (local.get $rec) (local.get $p1) (local.get $p2)))))
    (if (i32.eq (local.get $msg) (i32.const 0x400D))   ;; DECOMPRESS: ICDECOMPRESS*
      (then
        (if (i32.eqz (local.get $p1)) (then (return (global.get $ICERR_BADPARAM))))
        (return (call $icm_decompress (local.get $rec)
          (call $gl32 (local.get $p1))
          (call $gl32 (i32.add (local.get $p1) (i32.const 4)))
          (call $gl32 (i32.add (local.get $p1) (i32.const 8)))
          (call $gl32 (i32.add (local.get $p1) (i32.const 12)))
          (call $gl32 (i32.add (local.get $p1) (i32.const 16)))))))
    (if (i32.or (i32.eq (local.get $msg) (i32.const 0x400E))    ;; DECOMPRESS_END
                (i32.eq (local.get $msg) (i32.const 0x403F)))   ;; DECOMPRESSEX_END
      (then (i32.store offset=36 (local.get $rec) (i32.const 0)) (return (global.get $ICERR_OK))))
    (if (i32.eq (local.get $msg) (i32.const 0x401E))   ;; DECOMPRESS_GET_PALETTE
      (then (return (call $icm_get_palette (local.get $rec) (local.get $p1) (local.get $p2)))))
    (if (i32.or (i32.eq (local.get $msg) (i32.const 0x403C))    ;; DECOMPRESSEX_BEGIN
                (i32.eq (local.get $msg) (i32.const 0x403D)))   ;; DECOMPRESSEX_QUERY
      (then
        (if (i32.eqz (local.get $p1)) (then (return (global.get $ICERR_BADPARAM))))
        (if (i32.eq (local.get $msg) (i32.const 0x403D))
          (then (return (call $icm_query (local.get $codec)
            (call $gl32 (i32.add (local.get $p1) (i32.const 4)))
            (call $gl32 (i32.add (local.get $p1) (i32.const 12)))))))
        (return (call $icm_begin (local.get $rec)
          (call $gl32 (i32.add (local.get $p1) (i32.const 4)))
          (call $gl32 (i32.add (local.get $p1) (i32.const 12)))))))
    (if (i32.eq (local.get $msg) (i32.const 0x403E))   ;; DECOMPRESSEX
      (then
        (if (i32.eqz (local.get $p1)) (then (return (global.get $ICERR_BADPARAM))))
        (return (call $icm_decompress_ex (local.get $rec) (local.get $p1)))))
    (if (i32.eq (local.get $msg) (i32.const 0x5002))   ;; GETINFO
      (then (return (call $icm_fill_info (local.get $codec) (local.get $p1) (local.get $p2)))))
    (if (i32.eq (local.get $msg) (i32.const 0x5000))   ;; GETSTATE: no state to save
      (then (return (i32.const 0))))
    (if (i32.eq (local.get $msg) (i32.const 0x0808))   ;; DRV_QUERYCONFIGURE
      (then (return (i32.const 0))))
    ;; SET_PALETTE (dither to a caller palette), CONFIGURE, ABOUT, the
    ;; compressor and draw messages: not provided by these codecs.
    (global.get $ICERR_UNSUPPORTED))

  ;; ---- API front doors ------------------------------------------------

  ;; ICOpen(fccType, fccHandler, wMode) -> HIC
  (func $handle_ICOpen (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $codec i32) (local $hic i32)
    (local.set $codec (call $icm_codec_for_handler (local.get $arg1)))
    (if (i32.and (i32.ne (local.get $codec) (i32.const 0))
          (i32.and (call $icm_type_ok (local.get $arg0)) (call $icm_mode_ok (local.get $arg2))))
      (then (local.set $hic (call $icm_open_codec (local.get $codec) (local.get $arg1) (local.get $arg2)))))
    (i32.store offset=0 (global.get $reg_base) (local.get $hic))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  ;; ICClose(hic) -> ICERR
  (func $handle_ICClose (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $rec i32) (local $r i32)
    (local.set $rec (call $icm_rec_of (local.get $arg0)))
    (local.set $r (global.get $ICERR_BADHANDLE))
    (if (local.get $rec)
      (then
        (call $icm_ws_release (local.get $rec))
        (i32.store (local.get $rec) (i32.const 0))
        (local.set $r (global.get $ICERR_OK))))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  ;; ICInfo(fccType, fccHandler, lpicinfo) -> BOOL. A handler below 256 is
  ;; an index into the installed decompressors: Cinepak, then MS-RLE.
  (func $handle_ICInfo (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $codec i32) (local $ok i32)
    (if (call $icm_type_ok (local.get $arg0))
      (then
        (if (i32.lt_u (local.get $arg1) (i32.const 256))
          (then
            (if (i32.eqz (local.get $arg1)) (then (local.set $codec (global.get $ICM_CODEC_CVID))))
            (if (i32.eq (local.get $arg1) (i32.const 1)) (then (local.set $codec (global.get $ICM_CODEC_RLE8)))))
          (else
            (local.set $codec (call $icm_codec_for_handler (local.get $arg1)))
            (if (i32.eq (local.get $codec) (global.get $ICM_CODEC_RAW)) (then (local.set $codec (i32.const 0))))))
        (if (local.get $codec)
          (then (local.set $ok (i32.ne (call $icm_fill_info (local.get $codec) (local.get $arg2) (i32.const 568)) (i32.const 0)))))))
    (i32.store offset=0 (global.get $reg_base) (local.get $ok))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  ;; ICGetInfo(hic, lpicinfo, cb) -> bytes copied
  (func $handle_ICGetInfo (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $rec i32) (local $r i32)
    (local.set $rec (call $icm_rec_of (local.get $arg0)))
    (if (local.get $rec)
      (then (local.set $r (call $icm_fill_info (i32.load offset=4 (local.get $rec)) (local.get $arg1) (local.get $arg2)))))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  ;; ICSendMessage(hic, msg, dw1, dw2) -> LRESULT
  (func $handle_ICSendMessage (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $rec i32) (local $r i32)
    (local.set $rec (call $icm_rec_of (local.get $arg0)))
    (local.set $r (global.get $ICERR_BADHANDLE))
    (if (local.get $rec)
      (then (local.set $r (call $icm_message (local.get $rec) (local.get $arg1) (local.get $arg2) (local.get $arg3)))))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  ;; ICDecompress(hic, dwFlags, lpbiFormat, lpData, lpbi, lpBits) -> ICERR
  (func $handle_ICDecompress (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $rec i32) (local $r i32)
    (local.set $rec (call $icm_rec_of (local.get $arg0)))
    (local.set $r (global.get $ICERR_BADHANDLE))
    (if (local.get $rec)
      (then (local.set $r (call $icm_decompress (local.get $rec) (local.get $arg1) (local.get $arg2) (local.get $arg3)
        (local.get $arg4)
        (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)))))))
    (i32.store offset=0 (global.get $reg_base) (local.get $r))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  ;; ICLocate(fccType, fccHandler, lpbiIn, lpbiOut, wFlags) -> HIC: the named
  ;; handler if it accepts the formats, else whichever codec decodes lpbiIn.
  (func $handle_ICLocate (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $codec i32) (local $hic i32) (local $mode i32)
    (local.set $mode (i32.and (local.get $arg4) (i32.const 0xFFFF)))
    (if (i32.eqz (local.get $mode)) (then (local.set $mode (i32.const 2))))
    (if (i32.and (call $icm_type_ok (local.get $arg0)) (call $icm_mode_ok (local.get $mode)))
      (then
        (local.set $codec (call $icm_codec_for_handler (local.get $arg1)))
        (if (i32.or (i32.eqz (local.get $codec))
              (i32.ne (call $icm_query (local.get $codec) (local.get $arg2) (local.get $arg3)) (i32.const 0)))
          (then (local.set $codec (call $icm_codec_for_format (local.get $arg2)))))
        (if (i32.and (i32.ne (local.get $codec) (i32.const 0))
              (i32.eqz (call $icm_query (local.get $codec) (local.get $arg2) (local.get $arg3))))
          (then (local.set $hic (call $icm_open_codec (local.get $codec)
            (call $gl32 (i32.add (local.get $arg2) (i32.const 16))) (local.get $mode)))))))
    (i32.store offset=0 (global.get $reg_base) (local.get $hic))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
