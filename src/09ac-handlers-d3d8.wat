  ;; Direct3D 8 compatibility layer.  D3D8's fixed-function state is close
  ;; enough to D3D9 that the device shares the mature D3D9 backend state; the
  ;; ABI-facing vtable and presentation-parameter layout remain strictly D3D8.

  ;; Texture8 cannot reuse Texture9's vtable: D3D9 inserted three methods at
  ;; slot 14.  This per-instance lazy vtable is safe for worker instances and
  ;; leaves the fixed cross-thread registry layout untouched.
  (global $DX_VTBL_D3DTEX8 (mut i32) (i32.const 0))
  ;; D3D8 vertex-declaration token type 2. Spell this semantically because its
  ;; bit pattern happens to overlap the private thread-RPC address range.
  (global $D3D8_DECL_TOKEN_STREAM i32 (i32.const 536870912))

  (func $d3d8_not_available (result i32) (i32.const 0x8876086a))
  (func $d3d8_adapter_count (result i32) (i32.const 1))
  (func $d3d8_mode_count (param $adapter i32) (result i32)
    (i32.eqz (local.get $adapter)))
  (func $d3d8_adapter_monitor (param $adapter i32) (result i32)
    (drop (local.get $adapter))
    (i32.const 0))

  (func $handle_d3d8_not_available_6 (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_not_available))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))

  (func $handle_d3d8_not_available_7 (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_not_available))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))

  (func $handle_d3d8_unimplemented (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; Keep unsupported D3D8 methods fail-fast, including the original guest
    ;; call frame in the diagnostic. This intentionally never returns.
    (call $host_crash_unimplemented (local.get $name_ptr)
      (i32.load offset=16 (global.get $reg_base)) (global.get $eip) (i32.load offset=20 (global.get $reg_base)))
    (unreachable))

  (func $handle_Direct3DCreate8 (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $dx_create_com_obj (i32.const 37) (global.get $DX_VTBL_D3D8)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_IDirect3D8_QueryInterface (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $iid i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16)))
    (if (i32.eqz (local.get $arg2))
      (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x80004003)) (return))) ;; E_POINTER
    (call $gs32 (local.get $arg2) (i32.const 0))
    (if (i32.eqz (local.get $arg1))
      (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x80004003)) (return)))
    (local.set $iid (call $g2w (local.get $arg1)))
    ;; IID_IUnknown or IID_IDirect3D8
    (if (i32.or
          (call $guid_words_equal (local.get $iid)
            (i32.const 0) (i32.const 0) (i32.const 0x000000c0) (i32.const 0x46000000))
          (call $guid_words_equal (local.get $iid)
            (i32.const 0x1dd9e8da) (i32.const 0x4d401c77)
            (i32.const 0xfe98cfb0) (i32.const 0x1295fffd)))
      (then
        (drop (call $dx_com_addref (local.get $arg0)))
        (call $gs32 (local.get $arg2) (local.get $arg0))
        (i32.store offset=0 (global.get $reg_base) (i32.const 0))
        (return)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x80004002))) ;; E_NOINTERFACE

  (func $handle_IDirect3D8_RegisterSoftwareDevice (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_not_available))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_IDirect3D8_GetAdapterCount (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_adapter_count))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8))))

  (func $handle_IDirect3D8_GetAdapterIdentifier (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20)))
    (if (i32.or (local.get $arg1) (i32.eqz (local.get $arg3)))
      (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return)))
    ;; D3DADAPTER_IDENTIFIER8 is 0x42c bytes: Driver[512], Description[512],
    ;; then version, PCI ids, GUID and WHQL level, all left zero so no vendor
    ;; or certification is invented.  The two names match D3D9's identity;
    ;; launchers list Description in their adapter picker.
    ;; 0x42c bytes crosses a guest page boundary from most addresses, and two
    ;; adjacent sparse guest pages need not be adjacent in WASM memory -- so the
    ;; record is gathered and written back rather than filled through one $g2w.
    (local.set $arg4 (call $guest_span_in (local.get $arg3) (i32.const 0x42c)))
    (call $zero_memory (local.get $arg4) (i32.const 0x42c))
    (i32.store (local.get $arg4) (i32.const 0x656e6977))            ;; "wine"
    (i32.store offset=4 (local.get $arg4) (i32.const 0x7373612d))   ;; "-ass"
    (i32.store offset=8 (local.get $arg4) (i32.const 0x6c626d65))   ;; "embl"
    (i32.store offset=12 (local.get $arg4) (i32.const 0x00000079))  ;; "y"
    (i32.store offset=512 (local.get $arg4) (i32.const 0x656e6957)) ;; "Wine"
    (i32.store offset=516 (local.get $arg4) (i32.const 0x73734120)) ;; " Ass"
    (i32.store offset=520 (local.get $arg4) (i32.const 0x6c626d65)) ;; "embl"
    (i32.store offset=524 (local.get $arg4) (i32.const 0x33442079)) ;; "y D3"
    (i32.store offset=528 (local.get $arg4) (i32.const 0x003844))   ;; "D8"
    (call $guest_span_writeback (local.get $arg3) (local.get $arg4) (i32.const 0x42c))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)))

  (func $handle_IDirect3D8_GetAdapterModeCount (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_mode_count (local.get $arg1)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $d3d8_write_display_mode (param $out i32) (result i32)
    (if (i32.eqz (local.get $out)) (then (return (i32.const 0x8876086c))))
    (call $gs32 (local.get $out) (i32.const 640))
    (call $gs32 (i32.add (local.get $out) (i32.const 4)) (i32.const 480))
    (call $gs32 (i32.add (local.get $out) (i32.const 8)) (i32.const 60))
    (call $gs32 (i32.add (local.get $out) (i32.const 12)) (i32.const 22)) ;; X8R8G8B8
    (i32.const 0))

  (func $handle_IDirect3D8_EnumAdapterModes (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (if (result i32) (i32.and (i32.eqz (local.get $arg1)) (i32.eqz (local.get $arg2)))
        (then (call $d3d8_write_display_mode (local.get $arg3)))
        (else (i32.const 0x8876086c))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_IDirect3D8_GetAdapterDisplayMode (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (if (result i32) (i32.eqz (local.get $arg1))
        (then (call $d3d8_write_display_mode (local.get $arg2)))
        (else (i32.const 0x8876086c))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_IDirect3D8_CheckDeviceType (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $windowed i32)
    ;; this, Adapter, CheckType, DisplayFormat and BackBufferFormat are the five
    ;; direct dispatcher arguments.  Windowed is the sixth COM argument.
    (local.set $windowed (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)))
    (if (local.get $arg1) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return))) ;; D3DERR_INVALIDCALL
    (if (i32.ne (local.get $arg2) (i32.const 1)) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086b)) (return))) ;; D3DERR_INVALIDDEVICE
    ;; The sole enumerated display mode is X8R8G8B8.  Its back buffer may add
    ;; alpha, but otherwise must have the same RGB layout.  The shared backend
    ;; supports both its advertised windowed and fullscreen paths.
    (if (i32.or (i32.ne (local.get $arg3) (i32.const 22))
          (i32.and (i32.ne (local.get $arg4) (i32.const 22))
                   (i32.ne (local.get $arg4) (i32.const 21)))) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086a)) (return))) ;; D3DERR_NOTAVAILABLE
    (drop (local.get $windowed))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)))

  (func $handle_IDirect3D8_CheckDeviceFormat (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $rtype i32) (local $format i32) (local $ok i32)
    ;; RType and CheckFormat are arguments six and seven including this.
    (local.set $rtype (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (local.set $format (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)))
    (if (i32.or (local.get $arg1) (i32.ne (local.get $arg2) (i32.const 1))) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return))) ;; D3DERR_INVALIDCALL
    ;; Only X8R8G8B8 is exposed as an adapter mode.  Each answer below asks the
    ;; same format gate the matching create path uses, so capability
    ;; negotiation can never promise a resource that create then refuses.
    ;;   Usage 0, RType TEXTURE (3): ordinary 2D textures.
    ;;   D3DUSAGE_RENDERTARGET (1), RType SURFACE (1): the colour targets the
    ;;     back buffer and CreateRenderTarget accept.
    ;;   D3DUSAGE_DEPTHSTENCIL (2), RType SURFACE (1): the depth formats the
    ;;     auto depth buffer and CreateDepthStencilSurface accept.
    ;; NetImmerse (Morrowind) builds its frame-buffer and depth/stencil mode
    ;; lists from the last two; refusing them left both lists empty and the
    ;; renderer failed with "Unknown stencil mode format".
    (if (i32.eq (local.get $arg3) (i32.const 22)) (then
      (if (i32.and (i32.eqz (local.get $arg4)) (i32.eq (local.get $rtype) (i32.const 3)))
        (then (local.set $ok (call $d3d9_texture_format_supported (local.get $format)))))
      (if (i32.and (i32.eq (local.get $arg4) (i32.const 1)) (i32.eq (local.get $rtype) (i32.const 1)))
        (then (local.set $ok (call $d3d9_color_target_format (local.get $format)))))
      (if (i32.and (i32.eq (local.get $arg4) (i32.const 2)) (i32.eq (local.get $rtype) (i32.const 1)))
        (then (local.set $ok (call $d3d9_depth_format (local.get $format)))))))
    (i32.store offset=0 (global.get $reg_base) (select (i32.const 0) (i32.const 0x8876086a) (local.get $ok)))) ;; D3DERR_NOTAVAILABLE

  ;; IDirect3D8_CheckDepthStencilMatch(this, Adapter, DeviceType, AdapterFormat,
  ;; RenderTargetFormat, DepthStencilFormat) -- 6 args.  Same answer as D3D9's:
  ;; any colour target the backend presents pairs with any depth format it
  ;; creates.
  (func $handle_IDirect3D8_CheckDepthStencilMatch (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $depth_format i32)
    (local.set $depth_format (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)))
    (if (i32.or (local.get $arg1) (i32.ne (local.get $arg2) (i32.const 1))) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return))) ;; D3DERR_INVALIDCALL
    (i32.store offset=0 (global.get $reg_base) (select (i32.const 0) (i32.const 0x8876086a) ;; D3DERR_NOTAVAILABLE
        (i32.and (i32.eq (local.get $arg3) (i32.const 22))
          (i32.and (call $d3d9_color_target_format (local.get $arg4))
                   (call $d3d9_depth_format (local.get $depth_format)))))))

  (func $handle_IDirect3D8_CheckDeviceMultiSampleType (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $multisample i32)
    ;; arg4 is Windowed; MultiSampleType is the sixth COM argument on-stack.
    (local.set $multisample (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)))
    (if (i32.or (local.get $arg1) (i32.gt_u (local.get $multisample) (i32.const 16))) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return))) ;; D3DERR_INVALIDCALL
    (if (i32.ne (local.get $arg2) (i32.const 1)) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086b)) (return))) ;; D3DERR_INVALIDDEVICE
    ;; The backend exposes no antialias target.  NONE works for either
    ;; windowed/fullscreen mode on the two 32-bit color surface layouts it can
    ;; present; every real multisample technique is unavailable.
    (if (i32.or (local.get $multisample)
          (i32.and (i32.ne (local.get $arg3) (i32.const 22))
                   (i32.ne (local.get $arg3) (i32.const 21)))) (then
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086a)) (return))) ;; D3DERR_NOTAVAILABLE
    (drop (local.get $arg4))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)))

  (func $d3d8_fill_caps (param $out i32) (result i32)
    (local $caps i32)
    (if (i32.eqz (local.get $out)) (then (return (i32.const 0x8876086c))))
    ;; D3DCAPS8 is 0xd4 bytes and crosses a guest page boundary from most
    ;; addresses; the two halves need not be adjacent in WASM memory.
    (local.set $caps (call $guest_span_in (local.get $out) (i32.const 0xd4)))
    (call $zero_memory (local.get $caps) (i32.const 0xd4))
    (i32.store (local.get $caps) (i32.const 1))       ;; DeviceType = HAL
    ;; Advertise the fixed-function surface the shared WebGL backend actually
    ;; implements. Leaving every bitfield zero made UE2 disable mipmaps and
    ;; material paths even though CreateTexture and the fixed-function compiler
    ;; handle them. Keep cube/volume textures, anisotropy, hardware T&L and
    ;; programmable shaders clear: their D3D8 entry points are not implemented.
    (i32.store offset=0x0c (local.get $caps) (i32.const 0x00080000)) ;; CANRENDERWINDOWED
    (i32.store offset=0x1c (local.get $caps) (i32.const 0x00088f00)) ;; DevCaps
    (i32.store offset=0x20 (local.get $caps) (i32.const 0x00000ef0)) ;; PrimitiveMiscCaps
    (i32.store offset=0x24 (local.get $caps) (i32.const 0x00600190)) ;; RasterCaps
    (i32.store offset=0x28 (local.get $caps) (i32.const 0x000000ff)) ;; ZCmpCaps
    (i32.store offset=0x2c (local.get $caps) (i32.const 0x000007ff)) ;; SrcBlendCaps
    (i32.store offset=0x30 (local.get $caps) (i32.const 0x000007ff)) ;; DestBlendCaps
    (i32.store offset=0x34 (local.get $caps) (i32.const 0x000000ff)) ;; AlphaCmpCaps
    (i32.store offset=0x38 (local.get $caps) (i32.const 0x00084208)) ;; ShadeCaps
    (i32.store offset=0x3c (local.get $caps) (i32.const 0x00004405)) ;; TextureCaps
    (i32.store offset=0x40 (local.get $caps) (i32.const 0x03030300)) ;; TextureFilterCaps
    (i32.store offset=0x4c (local.get $caps) (i32.const 0x00000017)) ;; TextureAddressCaps
    (i32.store offset=0x54 (local.get $caps) (i32.const 0x0000001f)) ;; LineCaps
    (i32.store offset=0x58 (local.get $caps) (i32.const 4096))
    (i32.store offset=0x5c (local.get $caps) (i32.const 4096))
    (i32.store offset=0x64 (local.get $caps) (i32.const 8192)) ;; MaxTextureRepeat
    (i32.store offset=0x68 (local.get $caps) (i32.const 4096)) ;; MaxTextureAspectRatio
    (i32.store offset=0x6c (local.get $caps) (i32.const 1))    ;; MaxAnisotropy
    (f32.store offset=0x70 (local.get $caps) (f32.const 1e10)) ;; MaxVertexW
    (i32.store offset=0x88 (local.get $caps) (i32.const 0x000000ff)) ;; StencilCaps
    (i32.store offset=0x8c (local.get $caps) (i32.const 8)) ;; eight FVF texcoords
    (i32.store offset=0x90 (local.get $caps) (i32.const 0x03feffff)) ;; TextureOpCaps
    (i32.store offset=0x94 (local.get $caps) (i32.const 8))
    (i32.store offset=0x98 (local.get $caps) (i32.const 8))
    (i32.store offset=0x9c (local.get $caps) (i32.const 0x0000003b)) ;; VertexProcessingCaps
    (i32.store offset=0xa0 (local.get $caps) (i32.const 8)) ;; MaxActiveLights
    (f32.store offset=0xb0 (local.get $caps) (f32.const 1)) ;; MaxPointSize
    ;; Zero here means the device cannot draw a single primitive. UE2 records
    ;; these limits and later sizes/splits its dynamic batches from them.
    (i32.store offset=0xb4 (local.get $caps) (i32.const 1048575)) ;; MaxPrimitiveCount
    (i32.store offset=0xb8 (local.get $caps) (i32.const 1048575)) ;; MaxVertexIndex
    (i32.store offset=0xbc (local.get $caps) (i32.const 8)) ;; MaxStreams
    (i32.store offset=0xc0 (local.get $caps) (i32.const 255))
    (i32.store offset=0xc8 (local.get $caps) (i32.const 96)) ;; MaxVertexShaderConst
    (call $guest_span_writeback (local.get $out) (local.get $caps) (i32.const 0xd4))
    (i32.const 0))

  (func $handle_IDirect3D8_GetDeviceCaps (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20)))
    (if (i32.or (local.get $arg1) (i32.ne (local.get $arg2) (i32.const 1)))
      (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return)))
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_fill_caps (local.get $arg3))))

  (func $handle_IDirect3D8_GetAdapterMonitor (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; Browser guests have no native HMONITOR.  Return NULL without claiming a
    ;; host monitor even for adapter zero.
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_adapter_monitor (local.get $arg1)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  ;; Translate D3DPRESENT_PARAMETERS8 (52 bytes) to the D3D9 layout (56 bytes)
  ;; and let the established D3D9 device/backend allocator do the real work.
  (func $handle_IDirect3D8_CreateDevice (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $pp8 i32) (local $out i32) (local $pp9 i32) (local $dev i32) (local $hr i32)
    (local.set $pp8 (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (local.set $out (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))
    (if (i32.or (i32.eqz (local.get $pp8)) (i32.eqz (local.get $out))) (then
      (if (local.get $out) (then (call $gs32 (local.get $out) (i32.const 0))))
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c))
      (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)))
      (return)))
    (local.set $pp9 (call $heap_alloc (i32.const 56)))
    (if (i32.eqz (local.get $pp9)) (then
      (call $gs32 (local.get $out) (i32.const 0))
      (i32.store offset=0 (global.get $reg_base) (i32.const 0x8007000e))
      (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)))
      (return)))
    (call $zero_memory (call $g2w (local.get $pp9)) (i32.const 56))
    (memory.copy (call $g2w (local.get $pp9)) (call $g2w (local.get $pp8)) (i32.const 20))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 24)) (call $gl32 (i32.add (local.get $pp8) (i32.const 20))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 28)) (call $gl32 (i32.add (local.get $pp8) (i32.const 24))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 32)) (call $gl32 (i32.add (local.get $pp8) (i32.const 28))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 36)) (call $gl32 (i32.add (local.get $pp8) (i32.const 32))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 40)) (call $gl32 (i32.add (local.get $pp8) (i32.const 36))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 44)) (call $gl32 (i32.add (local.get $pp8) (i32.const 40))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 48)) (call $gl32 (i32.add (local.get $pp8) (i32.const 44))))
    (call $gs32 (i32.add (local.get $pp9) (i32.const 52)) (call $gl32 (i32.add (local.get $pp8) (i32.const 48))))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $pp9))
    (call $handle_IDirect3D9_CreateDevice
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4) (local.get $name_ptr))
    (local.set $hr (i32.load offset=0 (global.get $reg_base)))
    (if (i32.eqz (local.get $hr)) (then
      (local.set $dev (call $gl32 (local.get $out)))
      (if (local.get $dev) (then
        (i32.store (call $g2w (local.get $dev)) (global.get $DX_VTBL_D3DDEV8))))))
    (call $heap_free (local.get $pp9))
    (i32.store offset=0 (global.get $reg_base) (local.get $hr)))

  (func $handle_IDirect3DDevice8_QueryInterface (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16)))
    (if (i32.eqz (local.get $arg2)) (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x80004003)) (return)))
    (call $gs32 (local.get $arg2) (i32.const 0))
    (if (i32.eqz (local.get $arg1)) (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x80004003)) (return)))
    (if (i32.or
          (call $guid_words_equal (call $g2w (local.get $arg1))
            (i32.const 0) (i32.const 0) (i32.const 0x000000c0) (i32.const 0x46000000))
          (call $guid_words_equal (call $g2w (local.get $arg1))
            (i32.const 0x7385e5df) (i32.const 0x41d58fe8)
            (i32.const 0xb4d7b686) (i32.const 0xcfb64785)))
      (then
        (drop (call $dx_com_addref (local.get $arg0)))
        (call $gs32 (local.get $arg2) (local.get $arg0))
        (i32.store offset=0 (global.get $reg_base) (i32.const 0))
        (return)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x80004002)))

  (func $handle_IDirect3DDevice8_ResourceManagerDiscardBytes (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    ;; The browser backend owns resource residency. The byte count is an
    ;; advisory eviction request, so accepting it without eviction is valid.
    (drop (local.get $arg1))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_IDirect3DDevice8_GetDeviceCaps (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_fill_caps (local.get $arg1)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  (func $handle_IDirect3DDevice8_GetDisplayMode (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=0 (global.get $reg_base) (call $d3d8_write_display_mode (local.get $arg1)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  ;; D3D9 inserted a swap-chain index before D3D8's back-buffer index.
  ;; Devices in this backend expose only the implicit swap chain, so insert
  ;; zero and correct the delegated stdcall cleanup by one word.
  (func $handle_IDirect3DDevice8_GetBackBuffer (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DDevice9_GetBackBuffer
      (local.get $arg0) (i32.const 0) (local.get $arg1)
      (local.get $arg2) (local.get $arg3) (local.get $name_ptr))
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 4)))
    (call $d3d8_surface_out (local.get $arg3)))

  ;; D3D8's gamma ramp belongs to the device's implicit swap chain; D3D9
  ;; added the swap-chain index as the first argument.
  (func $handle_IDirect3DDevice8_SetGammaRamp (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $d3d9_gamma_ramp (local.get $arg0) (i32.const 0) (local.get $arg2) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_IDirect3DDevice8_GetGammaRamp (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $d3d9_gamma_ramp (local.get $arg0) (i32.const 0) (local.get $arg1) (i32.const 1))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12))))

  ;; D3D8 overloads SetVertexShader: fixed-function declarations are passed as
  ;; an FVF DWORD, while programmable shaders use handles returned by its
  ;; incompatible CreateVertexShader API. UE2's startup value is an FVF, so
  ;; translate that path to D3D9 SetFVF; shader handles remain explicitly
  ;; unsupported until CreateVertexShader itself has a D3D8 wrapper.
  (func $handle_IDirect3DDevice8_SetVertexShader (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (if (i32.ge_u (local.get $arg1) (i32.const 0x10000))
      (then
        (call $d3d9_declaration_bind (local.get $arg0) (local.get $arg1))
        (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
        (return)))
    (call $handle_IDirect3DDevice9_SetFVF
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))

  ;; GetVertexShader returns whatever SetVertexShader last bound: an FVF code
  ;; or a declaration handle. The backend keeps the two mutually exclusive
  ;; (binding one zeroes the other), so the non-zero FVF wins, else the handle.
  ;; D3D8 shader handles are not reference counted.
  (func $handle_IDirect3DDevice8_GetVertexShader (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $state i32) (local $fvf i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c))
    (local.set $state (call $d3d9_program_state (local.get $arg0)))
    (if (i32.or (i32.eqz (local.get $state)) (i32.eqz (local.get $arg1))) (then (return)))
    (local.set $fvf (call $gl32 (i32.add (local.get $state) (i32.const 12))))
    (call $gs32 (local.get $arg1)
      (select (local.get $fvf) (call $gl32 (i32.add (local.get $state) (i32.const 8)))
        (i32.ne (local.get $fvf) (i32.const 0))))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)))

  ;; CreatePixelShader fails loudly, so no D3D8 pixel-shader handle can exist:
  ;; the device is always on the fixed-function pixel pipeline, handle 0.
  ;; Binding 0 is therefore the only valid SetPixelShader.
  (func $handle_IDirect3DDevice8_GetPixelShader (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
    (if (i32.eqz (local.get $arg1)) (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)) (return)))
    (call $gs32 (local.get $arg1) (i32.const 0))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)))

  (func $handle_IDirect3DDevice8_SetPixelShader (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
    (i32.store offset=0 (global.get $reg_base) (select (i32.const 0x8876086c) (i32.const 0) (local.get $arg1))))

  ;; D3D9 inserted OffsetInBytes before Stride. D3D8 streams always begin at
  ;; byte zero, so supply that field and correct the delegated stack cleanup
  ;; from D3D9's six words back to D3D8's five.
  (func $handle_IDirect3DDevice8_SetStreamSource (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DDevice9_SetStreamSource
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (i32.const 0) (local.get $arg3) (local.get $name_ptr))
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 4))))

  ;; D3D8 retains BaseVertexIndex at SetIndices time; D3D9 moved that value to
  ;; DrawIndexedPrimitive. Keep the value in the reserved word between the
  ;; common clear-color and point-scale fields and bind the index buffer
  ;; normally. D3D9 itself neither reads nor writes this word.
  (func $handle_IDirect3DDevice8_SetIndices (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $state i32)
    (call $d3d9_buffer_bind (local.get $arg0) (local.get $arg1)
      (i32.const 7) (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.eqz (i32.load offset=0 (global.get $reg_base))) (then
      (local.set $state (call $d3d9_program_state (local.get $arg0)))
      (if (local.get $state) (then
        (call $gs32 (i32.add (local.get $state) (i32.const 1692)) (local.get $arg2))))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  ;; D3D8 keeps sampler controls in D3DTEXTURESTAGESTATETYPE. D3D9 moved
  ;; those same controls into D3DSAMPLERSTATETYPE, so forwarding the numeric
  ;; type to the D3D9 texture-stage handler rejected every address/filter call.
  ;; Return the D3D9 sampler-state number, or zero for a true shared TSS.
  (func $d3d8_sampler_type (param $type i32) (result i32)
    (if (result i32) (i32.lt_u (i32.sub (local.get $type) (i32.const 13)) (i32.const 2))
      (then (i32.sub (local.get $type) (i32.const 12)))
      (else (if (result i32) (i32.lt_u (i32.sub (local.get $type) (i32.const 15)) (i32.const 7))
        (then (i32.sub (local.get $type) (i32.const 11)))
        (else (select (i32.const 3) (i32.const 0)
          (i32.eq (local.get $type) (i32.const 25))))))))

  (func $handle_IDirect3DDevice8_GetTextureStageState (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $sampler i32)
    (local.set $sampler (call $d3d8_sampler_type (local.get $arg2)))
    (if (local.get $sampler)
      (then (call $d3d9_sampler_state (local.get $arg0) (local.get $arg1)
        (local.get $sampler) (local.get $arg3) (i32.const 1)))
      (else (if (i32.eq (local.get $arg2) (i32.const 32))
        (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)))
        (else (call $d3d9_texture_stage_state (local.get $arg0) (local.get $arg1)
          (local.get $arg2) (local.get $arg3) (i32.const 1))))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  (func $handle_IDirect3DDevice8_SetTextureStageState (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $sampler i32)
    (local.set $sampler (call $d3d8_sampler_type (local.get $arg2)))
    (if (local.get $sampler)
      (then (call $d3d9_sampler_state (local.get $arg0) (local.get $arg1)
        (local.get $sampler) (local.get $arg3) (i32.const 0)))
      (else (if (i32.eq (local.get $arg2) (i32.const 32))
        (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c)))
        (else (call $d3d9_texture_stage_state (local.get $arg0) (local.get $arg1)
          (local.get $arg2) (local.get $arg3) (i32.const 0))))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20))))

  ;; D3D8 exposes only render target zero and binds its color/depth pair in a
  ;; single call. D3D9 split those operations and added a target index.
  (func $handle_IDirect3DDevice8_SetRenderTarget (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $d3d9_color_binding (local.get $arg0) (i32.const 0) (call $d3d8_surface_in (local.get $arg1)))
    (if (i32.eqz (i32.load offset=0 (global.get $reg_base)))
      (then (call $d3d9_depth_binding (local.get $arg0) (local.get $arg2) (i32.const 0))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16))))

  (func $handle_IDirect3DDevice8_GetRenderTarget (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DDevice9_GetRenderTarget
      (local.get $arg0) (i32.const 0) (local.get $arg1)
      (local.get $arg3) (local.get $arg4) (local.get $name_ptr))
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 4)))
    (call $d3d8_surface_out (local.get $arg1)))

  ;; D3D8 surface creation has no MultisampleQuality, Discard or shared-handle
  ;; arguments. The backend renders single-sampled only, as its D3D9 creators
  ;; already require.
  ;; CreateRenderTarget(this, Width, Height, Format, MultiSample, Lockable, pp)
  (func $handle_IDirect3DDevice8_CreateRenderTarget (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $out i32)
    (local.set $out (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c))
    (if (i32.eqz (local.get $arg4)) (then
      (call $d3d9_color_create (local.get $arg0) (local.get $arg1) (local.get $arg2)
        (local.get $arg3) (i32.const 0) (i32.const 1)
        (i32.ne (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))) (i32.const 0))
        (local.get $out))
      (call $d3d8_surface_out (local.get $out))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))

  ;; CreateDepthStencilSurface(this, Width, Height, Format, MultiSample, pp)
  (func $handle_IDirect3DDevice8_CreateDepthStencilSurface (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $out i32) (local $surface i32)
    (local.set $out (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c))
    (if (i32.eqz (local.get $out)) (then (return)))
    (call $gs32 (local.get $out) (i32.const 0))
    (if (local.get $arg4) (then (return)))
    (local.set $surface (call $d3d9_depth_new (local.get $arg0) (local.get $arg1)
      (local.get $arg2) (local.get $arg3) (i32.const 0) (i32.const 1)))
    (if (i32.eqz (local.get $surface)) (then (return)))
    (call $gs32 (local.get $out) (local.get $surface))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0))
    (call $d3d8_surface_out (local.get $out)))

  ;; CreateImageSurface(this, Width, Height, Format, pp): a lockable
  ;; system-memory surface, D3D9's CreateOffscreenPlainSurface in SYSTEMMEM.
  (func $handle_IDirect3DDevice8_CreateImageSurface (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $d3d9_color_create (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (i32.const 2) (i32.const 0) (i32.const 1) (local.get $arg4))
    (call $d3d8_surface_out (local.get $arg4))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))))

  (func $handle_IDirect3DDevice8_GetDepthStencilSurface(param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DDevice9_GetDepthStencilSurface
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4) (local.get $name_ptr))
    (call $d3d8_surface_out (local.get $arg1)))

  ;; ── IDirect3DSurface8 ──────────────────────────────────────────────
  ;; The D3D9 backend owns every surface. Heap surfaces (color, depth and
  ;; texture levels) are recognised by the tag at +12, so a D3D8 caller can
  ;; be handed the same object with the D3D8 vtable written in place. The
  ;; implicit back buffer is an 8-byte COM wrapper whose identity the backend
  ;; checks against its SURF9 wrapper, so D3D8 gets an aux wrapper on the same
  ;; slot instead, and every D3D8 entry point maps it back before use.
  (global $DX_VTBL_D3DSURF8 (mut i32) (i32.const 0))

  (func $d3d8_surface_vtbl (result i32)
    (if (i32.eqz (global.get $DX_VTBL_D3DSURF8)) (then
      (global.set $DX_VTBL_D3DSURF8
        (call $init_com_vtable (global.get $API_ID_IDirect3DSurface8_BASE) (i32.const 11)))))
    (global.get $DX_VTBL_D3DSURF8))

  (func $d3d8_is_heap_surface (param $surface i32) (result i32)
    (i32.or (call $d3d9_is_texture_surface (local.get $surface))
      (i32.or (call $d3d9_is_color_surface (local.get $surface))
              (call $d3d9_is_depth_surface (local.get $surface)))))

  ;; After a successful D3D9 call stored a surface at `out`, give the caller
  ;; the D3D8 view of it.
  (func $d3d8_surface_out (param $out i32)
    (local $surface i32)
    (if (i32.or (i32.ne (i32.load offset=0 (global.get $reg_base)) (i32.const 0)) (i32.eqz (local.get $out))) (then (return)))
    (local.set $surface (call $gl32 (local.get $out)))
    (if (i32.eqz (local.get $surface)) (then (return)))
    (if (call $d3d8_is_heap_surface (local.get $surface)) (then
      (call $gs32 (local.get $surface) (call $d3d8_surface_vtbl))
      (return)))
    (call $gs32 (local.get $out)
      (call $dx_get_wrapper_for_vtbl
        (call $dx_slot_of (call $dx_from_this (local.get $surface)))
        (call $d3d8_surface_vtbl))))

  ;; The D3D9 identity of a surface pointer a D3D8 caller passed in. Keyed on
  ;; "not the SURF9 wrapper" rather than on this instance's SURF8 vtable, so
  ;; an aux wrapper made by another guest thread's instance maps back too.
  (func $d3d8_surface_in (param $surface i32) (result i32)
    (if (i32.eqz (local.get $surface)) (then (return (i32.const 0))))
    (if (call $d3d8_is_heap_surface (local.get $surface)) (then (return (local.get $surface))))
    (if (i32.eq (call $gl32 (local.get $surface)) (global.get $DX_VTBL_D3DSURF9))
      (then (return (local.get $surface))))
    (call $dx_get_wrapper_for_vtbl
      (call $dx_slot_of (call $dx_from_this (local.get $surface)))
      (global.get $DX_VTBL_D3DSURF9)))

  ;; D3D9 SURFACE_DESC: Format Type Usage Pool MultiSampleType
  ;; MultiSampleQuality Width Height. D3D8 replaces the fifth field with the
  ;; surface's byte Size and moves MultiSampleType into the sixth.
  (func $d3d8_desc_from_d3d9 (param $desc i32)
    (local $wa i32) (local $format i32) (local $width i32) (local $height i32) (local $size i32)
    (if (i32.or (i32.ne (i32.load offset=0 (global.get $reg_base)) (i32.const 0)) (i32.eqz (local.get $desc))) (then (return)))
    (local.set $wa (call $g2w (local.get $desc)))
    (local.set $format (i32.load (local.get $wa)))
    (local.set $width (i32.load offset=24 (local.get $wa)))
    (local.set $height (i32.load offset=28 (local.get $wa)))
    (local.set $size
      (if (result i32) (i32.eq (local.get $format) (i32.const 80)) ;; D16
        (then (i32.mul (i32.mul (local.get $width) (local.get $height)) (i32.const 2)))
        (else (i32.mul (call $d3d9_texture_pitch (local.get $width) (local.get $format))
                       (call $d3d9_texture_rows (local.get $height) (local.get $format))))))
    (i32.store offset=20 (local.get $wa) (i32.load offset=16 (local.get $wa)))
    (i32.store offset=16 (local.get $wa) (local.get $size)))

  (func $handle_IDirect3DSurface8_QueryInterface (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_QueryInterface (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_AddRef (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_AddRef (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_Release (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_Release (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_GetDevice (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_GetDevice (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_SetPrivateData (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_SetPrivateData (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_GetPrivateData (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_GetPrivateData (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_FreePrivateData (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_FreePrivateData (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_GetContainer (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_GetContainer (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_GetDesc (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_GetDesc (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr))
    (call $d3d8_desc_from_d3d9 (local.get $arg1)))
  (func $handle_IDirect3DSurface8_LockRect (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_LockRect (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))
  (func $handle_IDirect3DSurface8_UnlockRect (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DSurface9_UnlockRect (call $d3d8_surface_in (local.get $arg0))
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr)))

  (func $handle_IDirect3DTexture8_GetLevelDesc (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DTexture9_GetLevelDesc (local.get $arg0)
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr))
    (call $d3d8_desc_from_d3d9 (local.get $arg2)))

  (func $handle_IDirect3DTexture8_GetSurfaceLevel (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $handle_IDirect3DTexture9_GetSurfaceLevel (local.get $arg0)
      (local.get $arg1) (local.get $arg2) (local.get $arg3) (local.get $arg4) (local.get $name_ptr))
    (call $d3d8_surface_out (local.get $arg2)))

  ;; D3D8 CreateTexture is D3D9 CreateTexture without the final shared-handle
  ;; parameter. Feed its otherwise identical fields to the common allocator.
  (func $handle_IDirect3DDevice8_CreateTexture (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $out i32) (local $texture i32)
    (local.set $out (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32))))
    (call $d3d9_texture_create
      (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4)
      (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)))
      (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)))
      (local.get $out))
    (if (i32.eqz (i32.load offset=0 (global.get $reg_base))) (then
      (local.set $texture (call $gl32 (local.get $out)))
      (if (local.get $texture) (then
        (if (i32.eqz (global.get $DX_VTBL_D3DTEX8)) (then
          (global.set $DX_VTBL_D3DTEX8
            (call $init_com_vtable (global.get $API_ID_IDirect3DTexture8_BASE) (i32.const 19)))))
        (call $gs32 (local.get $texture) (global.get $DX_VTBL_D3DTEX8))))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36))))

  ;; D3D8 vertex/index buffer creation has the same fields as D3D9 except for
  ;; D3D9's trailing shared-handle pointer. Allocate the common buffer object
  ;; directly so the six-argument D3D8 stdcall frame is consumed exactly.
  (func $handle_IDirect3DDevice8_CreateVertexBuffer (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $d3d9_buffer_create (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4)
      (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))) (i32.const 6))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))

  (func $handle_IDirect3DDevice8_CreateIndexBuffer (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (call $d3d9_buffer_create (local.get $arg0) (local.get $arg1) (local.get $arg2)
      (local.get $arg3) (local.get $arg4)
      (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))) (i32.const 7))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))

  ;; Pair D3D8's retained SetIndices base with every indexed draw while
  ;; preserving the common D3D9 async draw protocol.
  (func $handle_IDirect3DDevice8_DrawIndexedPrimitive (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $state i32) (local $base i32)
    (local.set $state (call $d3d9_program_state (local.get $arg0)))
    (if (local.get $state) (then
      (local.set $base (call $gl32 (i32.add (local.get $state) (i32.const 1692))))))
    (call $d3d9_draw_buffer (local.get $arg0) (local.get $arg1) (local.get $base)
      (local.get $arg2) (local.get $arg3) (local.get $arg4)
      (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))) (i32.const 1))
    (if (global.get $d3d_render_token) (then (return)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))))

  ;; Convert the Direct3D 8 declaration token stream into D3DVERTEXELEMENT9.
  ;; UE2's software-T&L declarations use stream zero, FLOAT1..4/D3DCOLOR and
  ;; no shader function. The returned D3D9 declaration COM pointer is opaque
  ;; to D3D8 callers and serves as their DWORD shader/declaration handle.
  (func $handle_IDirect3DDevice8_CreateVertexShader (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (local $src i32) (local $tmp i32) (local $elem i32) (local $token i32)
    (local $stream i32) (local $offset i32) (local $dtype i32) (local $reg i32)
    (local $usage i32) (local $usage_index i32) (local $size i32)
    (local $count i32) (local $elements i32)
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)))
    (if (local.get $arg3) (then (call $gs32 (local.get $arg3) (i32.const 0))))
    (if (i32.or (i32.eqz (local.get $arg1))
          (i32.or (local.get $arg2) (i32.eqz (local.get $arg3)))) (then (return)))
    (local.set $tmp (call $heap_alloc (i32.const 136)))
    (if (i32.eqz (local.get $tmp))
      (then (i32.store offset=0 (global.get $reg_base) (i32.const 0x8007000e)) (return)))
    (local.set $src (call $g2w (local.get $arg1)))
    (block $finish (loop $tokens
      (if (i32.ge_u (local.get $count) (i32.const 32))
        (then (call $heap_free (local.get $tmp)) (return)))
      (local.set $token (i32.load (i32.add (local.get $src) (i32.mul (local.get $count) (i32.const 4)))))
      (local.set $count (i32.add (local.get $count) (i32.const 1)))
      (if (i32.eq (local.get $token) (i32.const 0xffffffff)) (then (br $finish)))
      (if (i32.eq (i32.and (local.get $token) (i32.const 0xf0000000)) (global.get $D3D8_DECL_TOKEN_STREAM))
        (then
          (local.set $stream (i32.and (local.get $token) (i32.const 0xf)))
          ;; D3D8 exposes the same sixteen stream selectors now implemented by
          ;; the common D3D9 binding table. Preserve the selector: UT2003's
          ;; terrain declaration splits position/normal/colors/UVs over 0..4.
          (if (i32.ge_u (local.get $stream) (i32.const 16))
            (then (call $heap_free (local.get $tmp)) (return)))
          (local.set $offset (i32.const 0))
          (br $tokens)))
      (if (i32.ne (i32.and (local.get $token) (i32.const 0xf0000000)) (i32.const 0x40000000))
        (then (call $heap_free (local.get $tmp)) (return)))
      (local.set $dtype (i32.and (i32.shr_u (local.get $token) (i32.const 16)) (i32.const 0xf)))
      (local.set $reg (i32.and (local.get $token) (i32.const 0x1f)))
      (if (i32.or (i32.gt_u (local.get $dtype) (i32.const 4))
            (i32.gt_u (local.get $reg) (i32.const 16)))
        (then (call $heap_free (local.get $tmp)) (return)))
      (local.set $usage_index (i32.const 0))
      (local.set $usage
        (if (result i32) (i32.eqz (local.get $reg)) (then (i32.const 0))
          (else (if (result i32) (i32.eq (local.get $reg) (i32.const 1)) (then (i32.const 1))
            (else (if (result i32) (i32.eq (local.get $reg) (i32.const 2)) (then (i32.const 2))
              (else (if (result i32) (i32.eq (local.get $reg) (i32.const 3)) (then (i32.const 3))
                (else (if (result i32) (i32.eq (local.get $reg) (i32.const 4)) (then (i32.const 4))
                  (else (if (result i32) (i32.lt_u (local.get $reg) (i32.const 7))
                    (then (local.set $usage_index (i32.sub (local.get $reg) (i32.const 5))) (i32.const 10))
                    (else (if (result i32) (i32.lt_u (local.get $reg) (i32.const 15))
                      (then (local.set $usage_index (i32.sub (local.get $reg) (i32.const 7))) (i32.const 5))
                      (else (if (result i32) (i32.eq (local.get $reg) (i32.const 15))
                        (then (local.set $usage_index (i32.const 1)) (i32.const 0))
                        (else (local.set $usage_index (i32.const 1)) (i32.const 3))))))))))))))))))
      (local.set $elem (i32.add (call $g2w (local.get $tmp))
        (i32.mul (local.get $elements) (i32.const 8))))
      (i32.store16 (local.get $elem) (local.get $stream))
      (i32.store16 offset=2 (local.get $elem) (local.get $offset))
      (i32.store8 offset=4 (local.get $elem) (local.get $dtype))
      (i32.store8 offset=5 (local.get $elem) (i32.const 0))
      (i32.store8 offset=6 (local.get $elem) (local.get $usage))
      (i32.store8 offset=7 (local.get $elem) (local.get $usage_index))
      (local.set $elements (i32.add (local.get $elements) (i32.const 1)))
      (local.set $size
        (if (result i32) (i32.eqz (local.get $dtype)) (then (i32.const 4))
          (else (if (result i32) (i32.eq (local.get $dtype) (i32.const 1)) (then (i32.const 8))
            (else (if (result i32) (i32.eq (local.get $dtype) (i32.const 2)) (then (i32.const 12))
              (else
                (if (result i32) (i32.eq (local.get $dtype) (i32.const 3))
                  (then (i32.const 16)) (else (i32.const 4))))))))))
      (local.set $offset (i32.add (local.get $offset) (local.get $size)))
      (br $tokens)))
    (local.set $elem (i32.add (call $g2w (local.get $tmp))
      (i32.mul (local.get $elements) (i32.const 8))))
    (i32.store (local.get $elem) (i32.const 0x000000ff))
    (i32.store offset=4 (local.get $elem) (i32.const 0x00000011))
    (call $d3d9_declaration_create (local.get $arg0) (local.get $tmp) (local.get $arg3))
    (call $heap_free (local.get $tmp)))

  (func $handle_IDirect3DDevice8_DeleteVertexShader (param $arg0 i32) (param $arg1 i32) (param $arg2 i32) (param $arg3 i32) (param $arg4 i32) (param $name_ptr i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x8876086c))
    (if (i32.ge_u (local.get $arg1) (i32.const 0x10000))
      (then
        (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
        (call $handle_IDirect3DVertexDeclaration9_Release
          (local.get $arg1) (i32.const 0) (i32.const 0)
          (i32.const 0) (i32.const 0) (local.get $name_ptr))
        (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4)))
        (i32.store offset=0 (global.get $reg_base) (i32.const 0)))))
