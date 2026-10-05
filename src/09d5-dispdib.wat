  ;; ---------------------------------------------------------------------
  ;; DISPDIB — the Video for Windows full-screen DIB display driver.
  ;;
  ;; DISPDIB.DLL is not an API a program calls through GetProcAddress. A
  ;; caller LoadModule()s it and then drives it entirely through messages to a
  ;; window of the class it registers, "DisplayDibWindow" — which is why a
  ;; trace of a DISPDIB user shows a module load, a CreateWindowEx and nothing
  ;; else. So the emulated surface is a built-in module answer plus a
  ;; WAT-native wndproc, not a DLL.
  ;;
  ;; The protocol below is what Pitfall (Over 1000 Games CD, ARCADE/PITFALL)
  ;; actually sends, read out of PITFALL.EXE at 0x0044104e; see
  ;; docs/re-notes/over1000games-shareware.md. Three sends are visible
  ;; statically: WM_COPYDATA with dwData 0x400 (mode + palette), 0x403 (start)
  ;; and 0x404 (stop). How a frame of pixels arrives is deliberately NOT
  ;; guessed here: every other private message traps by name, so the first run
  ;; that needs one says which it is instead of silently drawing nothing.
  ;; ---------------------------------------------------------------------

  (data (region.addr $DISPDIB_STRINGS 0x00) "DisplayDibWindow\00")
  (data (region.addr $DISPDIB_STRINGS 0x20) "dispdib.dll\00")
  (data (region.addr $DISPDIB_STRINGS 0x30) "DISPDIB DisplayDibWindow message\00")

  ;; Is this CreateWindowEx class name DISPDIB's window class? Callers must
  ;; already have rejected MAKEINTATOM values; a class atom is not a pointer.
  (func $dispdib_is_class_name (param $guest i32) (result i32)
    (if (i32.lt_u (local.get $guest) (i32.const 0x10000))
      (then (return (i32.const 0))))
    (call $guest_ansi_eq_wasm_ci (local.get $guest)
      (region.addr $DISPDIB_STRINGS 0x00)))

  ;; Does this LoadModule/OpenFile path name DISPDIB? The caller builds it
  ;; from GetSystemDirectory, so the match is on the basename.
  (func $dispdib_is_module_path (param $guest i32) (result i32)
    (if (i32.eqz (local.get $guest)) (then (return (i32.const 0))))
    (call $dll_name_match (local.get $guest)
      (region.addr $DISPDIB_STRINGS 0x20)))

  (func $dispdib_attach (param $hwnd i32)
    (i32.store offset=0 (global.get $DISPDIB_STATE) (local.get $hwnd)))

  ;; WM_COPYDATA dwData=0x400: a BITMAPINFO — BITMAPINFOHEADER followed by the
  ;; palette. cbData is 0x428 for the 8bpp case (0x28 + 256 RGBQUADs), which is
  ;; how one message carries both the mode and the colours.
  (func $dispdib_set_mode (param $cds i32) (result i32)
    (local $bits i32) (local $cb i32) (local $bpp i32)
    (local.set $cb (call $gl32 (i32.add (local.get $cds) (i32.const 4))))
    (local.set $bits (call $gl32 (i32.add (local.get $cds) (i32.const 8))))
    (if (i32.eqz (local.get $bits)) (then (return (i32.const 0))))
    (if (i32.lt_u (local.get $cb) (i32.const 0x28)) (then (return (i32.const 0))))
    (local.set $bpp (call $gl16 (i32.add (local.get $bits) (i32.const 14))))
    (i32.store offset=8 (global.get $DISPDIB_STATE)
      (call $gl32 (i32.add (local.get $bits) (i32.const 4))))
    (i32.store offset=12 (global.get $DISPDIB_STATE)
      (call $gl32 (i32.add (local.get $bits) (i32.const 8))))
    (i32.store offset=16 (global.get $DISPDIB_STATE) (local.get $bpp))
    ;; Palette present only when the caller paid for one past the header.
    (i32.store offset=20 (global.get $DISPDIB_STATE)
      (i32.gt_u (local.get $cb) (i32.const 0x28)))
    (i32.store offset=24 (global.get $DISPDIB_STATE) (i32.const 1))
    (i32.const 1))

  (func $dispdib_wndproc (param $hwnd i32) (param $msg i32) (param $wParam i32) (param $lParam i32) (result i32)
    (call $dispdib_attach (local.get $hwnd))
    ;; WM_COPYDATA
    (if (i32.eq (local.get $msg) (i32.const 0x004A))
      (then
        (if (i32.eq (call $gl32 (local.get $lParam)) (i32.const 0x400))
          (then (return (call $dispdib_set_mode (local.get $lParam)))))
        (call $host_log_i32 (call $gl32 (local.get $lParam)))
        (call $crash_unimplemented
          (region.addr $DISPDIB_STRINGS 0x30))
        (return (i32.const 0))))
    ;; 0x403 start / 0x404 stop the full-screen display.
    (if (i32.eq (local.get $msg) (i32.const 0x403))
      (then
        (i32.store offset=4 (global.get $DISPDIB_STATE) (i32.const 1))
        (return (i32.const 1))))
    (if (i32.eq (local.get $msg) (i32.const 0x404))
      (then
        (i32.store offset=4 (global.get $DISPDIB_STATE) (i32.const 0))
        (return (i32.const 1))))
    ;; Anything else in the private range is a piece of the protocol we have
    ;; not seen yet. Trapping names it; returning 0 would leave a program
    ;; drawing into a driver that quietly discards every frame.
    (if (i32.ge_u (local.get $msg) (i32.const 0x400))
      (then
        (call $host_log_i32 (local.get $msg))
        (call $crash_unimplemented
          (region.addr $DISPDIB_STRINGS 0x30))))
    (i32.const 0))
