  ;; =========================================================================
  ;; GL software rasterization -- lower WAT-native GL draws onto the D3DIM
  ;; rasterizer, with no JS anywhere in the path.
  ;;
  ;; WHY THIS EXISTS, AND WHY IT IS NOT THE DSP1 PIPELINE.
  ;; docs/gl-software-path-design.md steps 3-5 route GL through the D3D9
  ;; software backend: assemble a DFX1, cascade it into a DSP1, hand that to
  ;; the shader VM.  Surveyed 2026-09-22 (write-up committed in that doc),
  ;; three of those pieces do not exist in WAT at all.  Nothing in WAT
  ;; consumes a DFX1 or a DLT1 -- $gl_dfx1_transform and $gl_dlt1_lighting are
  ;; test-only exports -- every descriptor the WAT rasterizer has ever seen was
  ;; assembled in JS by lib/d3d9-software-backend.js, and DSP1 wants raw BGRA
  ;; and f32 depth pointers that GL has no render target to supply.
  ;;
  ;; D3DIM already has all of that, driven straight from WAT with zero JS
  ;; crossings: $rasterize_triangle_textured samples a DxObject texture,
  ;; interpolates colour, Z and perspective-correct UVs, and does blending,
  ;; alpha test and depth test into a DxObject target; $d3d9_create_surface
  ;; hands those surfaces out.  A DxObject target is also what makes --png,
  ;; --dx-surfaces, --dx-slot and the browser present path see the frame, so
  ;; the "GL render target" the survey said did not exist is the surface
  ;; record D3DIM and D3D9 already share.  GL textures become ARGB8888
  ;; DxObject surfaces for the same reason.
  ;;
  ;; STATE.  The JS frontend keeps its own copy of GL state to answer the
  ;; guest's queries; this file keeps the part that decides pixels, fed by
  ;; $gl_sw_observe from the same encoder call site as the matrix mirror, so
  ;; the two cannot see different call streams.  glPushAttrib/glPopAttrib are
  ;; honoured per group for the fields kept here.
  ;;
  ;; CULLING FOLLOWS GL, NOT D3D.  GL_CULL_FACE is off by default; D3D's
  ;; default is D3DCULL_CCW, which 8b227b5c made this emulator honour.  So
  ;; this must NOT route through $d3dim_draw_tl_triangle_textured, whose
  ;; state comes from a D3D device's render-state block -- there is no D3D
  ;; device here.  It calls the rasterizer directly with GL's state.
  ;;
  ;; NOT DONE YET, each one visible rather than silent: near-plane clipping (a
  ;; triangle with a vertex at or behind the eye is dropped and counted in
  ;; gl_sw_clipped), lines and points, fixed-function lighting (vertex colours
  ;; are used as given), fog, texgen and the second texture unit, and texture
  ;; formats other than 8-bit RGBA/RGB/BGRA/LUMINANCE/ALPHA/LUMINANCE_ALPHA
  ;; (counted in gl_sw_tex_unsupported; such a texture samples as white).
  ;; =========================================================================

  (global $GL_SW_SCRATCH i32 (region.addr $GL_SW_SCRATCH 0))
  (global $GL_SW_SCRATCH_SIZE i32 (region.size $GL_SW_SCRATCH))
  (global $GL_SW_STATE i32 (region.addr $GL_SW_STATE 0))
  (global $GL_SW_STATE_SIZE i32 (region.size $GL_SW_STATE))
  (global $GL_SW_TEXTURES i32 (region.addr $GL_SW_TEXTURES 0))
  (global $GL_SW_TEXTURES_SIZE i32 (region.size $GL_SW_TEXTURES))

  ;; Off unless a host asks for it: with a JS GL backend present, both paths
  ;; drawing at once is two pictures, not one.
  (global $gl_sw_enabled (mut i32) (i32.const 0))
  ;; DxObject entry addresses of the colour target and its 16bpp depth
  ;; surface, 0 until first use. Draws land in $gl_sw_rt, the back buffer;
  ;; SwapBuffers copies it to $gl_sw_front, the primary everything else
  ;; displays. Drawing into the displayed surface directly would let a capture
  ;; or a browser repaint show a frame half drawn -- Quake II's menu came out
  ;; with its plaque and two of five items missing exactly that way.
  (global $gl_sw_rt (mut i32) (i32.const 0))
  (global $gl_sw_front (mut i32) (i32.const 0))
  (global $gl_sw_presents (mut i32) (i32.const 0))
  (global $gl_sw_zbuf (mut i32) (i32.const 0))
  ;; A 1x1 opaque white texture: an untextured triangle is drawn as this
  ;; texture MODULATEd by its vertex colours, which is exactly Gouraud colour
  ;; through the same depth, blend and alpha-test path as a textured one.
  (global $gl_sw_white (mut i32) (i32.const 0))
  ;; Census, so a test and --gl-census can tell "we drew nothing" from "we
  ;; were never asked to draw" from "we dropped it".
  (global $gl_sw_triangles (mut i32) (i32.const 0))
  (global $gl_sw_clipped (mut i32) (i32.const 0))
  (global $gl_sw_culled (mut i32) (i32.const 0))
  (global $gl_sw_tex_uploads (mut i32) (i32.const 0))
  (global $gl_sw_tex_unsupported (mut i32) (i32.const 0))
  ;; GL's default clear colour is (0,0,0,0).
  (global $gl_sw_clear_color (mut i32) (i32.const 0))
  ;; glPushAttrib depth, 0..16. GL requires at least 16.
  (global $gl_sw_attrib_depth (mut i32) (i32.const 0))

  ;; $GL_SW_STATE: the current state block (+0..+47), then the attrib stack
  ;; at +64, sixteen 64-byte frames of { mask, copy of the block }.
  ;;   +0  caps: 1 TEXTURE_2D, 2 BLEND, 4 ALPHA_TEST, 8 DEPTH_TEST, 16 CULL_FACE
  ;;   +4  source blend (D3DBLEND)        +8  destination blend (D3DBLEND)
  ;;   +12 alpha func (D3DCMP)            +16 alpha reference, 0..255
  ;;   +20 depth func (D3DCMP)            +24 depth mask, 0/1
  ;;   +28 cull face (GL enum)            +32 front face is CCW, 0/1
  ;;   +36 texture env (D3DTOP: 4 MODULATE, 2 SELECTARG1 = texture)
  ;;   +40 bound TEXTURE_2D name          +44 unpack alignment
  (func $gl_sw_state_defaults
    (local $s i32)
    (local.set $s (global.get $GL_SW_STATE))
    (i32.store offset=0 (local.get $s) (i32.const 0))
    (i32.store offset=4 (local.get $s) (i32.const 2))       ;; GL_ONE
    (i32.store offset=8 (local.get $s) (i32.const 1))       ;; GL_ZERO
    (i32.store offset=12 (local.get $s) (i32.const 8))      ;; GL_ALWAYS
    (i32.store offset=16 (local.get $s) (i32.const 0))
    (i32.store offset=20 (local.get $s) (i32.const 2))      ;; GL_LESS
    (i32.store offset=24 (local.get $s) (i32.const 1))
    (i32.store offset=28 (local.get $s) (i32.const 0x405))  ;; GL_BACK
    (i32.store offset=32 (local.get $s) (i32.const 1))      ;; GL_CCW
    (i32.store offset=36 (local.get $s) (i32.const 4))      ;; GL_MODULATE
    (i32.store offset=40 (local.get $s) (i32.const 0))
    (i32.store offset=44 (local.get $s) (i32.const 4))
    (global.set $gl_sw_attrib_depth (i32.const 0)))

  (func $gl_sw_cap_bit (param $cap i32) (result i32)
    (if (i32.eq (local.get $cap) (i32.const 0x0DE1)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $cap) (i32.const 0x0BE2)) (then (return (i32.const 2))))
    (if (i32.eq (local.get $cap) (i32.const 0x0BC0)) (then (return (i32.const 4))))
    (if (i32.eq (local.get $cap) (i32.const 0x0B71)) (then (return (i32.const 8))))
    (if (i32.eq (local.get $cap) (i32.const 0x0B44)) (then (return (i32.const 16))))
    (i32.const 0))

  ;; GL comparison (0x200 NEVER .. 0x207 ALWAYS) to D3DCMP (1 .. 8).
  (func $gl_sw_cmp (param $gl i32) (result i32)
    (if (i32.gt_u (i32.sub (local.get $gl) (i32.const 0x200)) (i32.const 7))
      (then (return (i32.const 8))))
    (i32.sub (local.get $gl) (i32.const 0x1FF)))

  ;; GL blend factor to D3DBLEND: ZERO 1, ONE 2, then SRC_COLOR (0x300) ..
  ;; SRC_ALPHA_SATURATE (0x308) are 3 .. 11 in the same order.
  (func $gl_sw_blend (param $gl i32) (param $fallback i32) (result i32)
    (if (i32.eqz (local.get $gl)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $gl) (i32.const 1)) (then (return (i32.const 2))))
    (if (i32.le_u (i32.sub (local.get $gl) (i32.const 0x300)) (i32.const 8))
      (then (return (i32.add (i32.sub (local.get $gl) (i32.const 0x300)) (i32.const 3)))))
    (local.get $fallback))

  ;; glPushAttrib/glPopAttrib for the fields kept here, per attribute group.
  (func $gl_sw_push_attrib (param $mask i32)
    (local $frame i32)
    ;; Past GL's required depth the push is dropped; the matching pop is then
    ;; dropped too, by the depth test in $gl_sw_pop_attrib.
    (if (i32.ge_u (global.get $gl_sw_attrib_depth) (i32.const 16)) (then (return)))
    (local.set $frame (i32.add (global.get $GL_SW_STATE)
      (i32.add (i32.const 64) (i32.mul (global.get $gl_sw_attrib_depth) (i32.const 64)))))
    (i32.store (local.get $frame) (local.get $mask))
    (call $memcpy (i32.add (local.get $frame) (i32.const 4)) (global.get $GL_SW_STATE) (i32.const 48))
    (global.set $gl_sw_attrib_depth (i32.add (global.get $gl_sw_attrib_depth) (i32.const 1))))

  ;; Restore one caps bit from a saved frame.
  (func $gl_sw_restore_caps (param $saved i32) (param $bits i32)
    (local $s i32)
    (local.set $s (global.get $GL_SW_STATE))
    (i32.store (local.get $s) (i32.or
      (i32.and (i32.load (local.get $s)) (i32.xor (local.get $bits) (i32.const -1)))
      (i32.and (i32.load (local.get $saved)) (local.get $bits)))))

  (func $gl_sw_pop_attrib
    (local $frame i32) (local $mask i32) (local $saved i32) (local $s i32)
    (if (i32.eqz (global.get $gl_sw_attrib_depth)) (then (return)))
    (global.set $gl_sw_attrib_depth (i32.sub (global.get $gl_sw_attrib_depth) (i32.const 1)))
    (local.set $frame (i32.add (global.get $GL_SW_STATE)
      (i32.add (i32.const 64) (i32.mul (global.get $gl_sw_attrib_depth) (i32.const 64)))))
    (local.set $mask (i32.load (local.get $frame)))
    (local.set $saved (i32.add (local.get $frame) (i32.const 4)))
    (local.set $s (global.get $GL_SW_STATE))
    ;; GL_ENABLE_BIT: every enable this file tracks.
    (if (i32.and (local.get $mask) (i32.const 0x2000))
      (then (call $gl_sw_restore_caps (local.get $saved) (i32.const 31))))
    ;; GL_COLOR_BUFFER_BIT: blend and alpha-test enables, functions, reference.
    (if (i32.and (local.get $mask) (i32.const 0x4000))
      (then
        (call $gl_sw_restore_caps (local.get $saved) (i32.const 6))
        (call $memcpy (i32.add (local.get $s) (i32.const 4))
          (i32.add (local.get $saved) (i32.const 4)) (i32.const 16))))
    ;; GL_DEPTH_BUFFER_BIT: depth test enable, function and mask.
    (if (i32.and (local.get $mask) (i32.const 0x100))
      (then
        (call $gl_sw_restore_caps (local.get $saved) (i32.const 8))
        (call $memcpy (i32.add (local.get $s) (i32.const 20))
          (i32.add (local.get $saved) (i32.const 20)) (i32.const 8))))
    ;; GL_POLYGON_BIT: cull enable, cull face, front face.
    (if (i32.and (local.get $mask) (i32.const 0x8))
      (then
        (call $gl_sw_restore_caps (local.get $saved) (i32.const 16))
        (call $memcpy (i32.add (local.get $s) (i32.const 28))
          (i32.add (local.get $saved) (i32.const 28)) (i32.const 8))))
    ;; GL_TEXTURE_BIT: TEXTURE_2D enable, texture env, binding.
    (if (i32.and (local.get $mask) (i32.const 0x40000))
      (then
        (call $gl_sw_restore_caps (local.get $saved) (i32.const 1))
        (call $memcpy (i32.add (local.get $s) (i32.const 36))
          (i32.add (local.get $saved) (i32.const 36)) (i32.const 8)))))

  ;; ---- textures ---------------------------------------------------------
  ;; $GL_SW_TEXTURES: one 8-byte slot per texture name below 4096,
  ;;   +0 the surface's COM object (guest pointer), 0 = no image yet
  ;;   +4 flags: 1 linear, 2 clamp S, 4 clamp T, 8 flags initialised
  ;; A name at or above 4096 has no slot and samples as white.
  (func $gl_sw_tex_slot (param $name i32) (result i32)
    (if (i32.ge_u (local.get $name) (i32.const 4096)) (then (return (i32.const 0))))
    (i32.add (global.get $GL_SW_TEXTURES) (i32.mul (local.get $name) (i32.const 8))))

  ;; GL's defaults are MAG_FILTER LINEAR and REPEAT in both directions.
  (func $gl_sw_tex_flags (param $slot i32) (result i32)
    (if (i32.eqz (i32.and (i32.load offset=4 (local.get $slot)) (i32.const 8)))
      (then (i32.store offset=4 (local.get $slot) (i32.const 9))))
    (i32.load offset=4 (local.get $slot)))

  ;; glTexParameter for TEXTURE_2D: MAG_FILTER picks linear sampling (the
  ;; rasterizer has one filter, and magnification is what a close surface
  ;; shows), WRAP_S/WRAP_T pick clamp for CLAMP and CLAMP_TO_EDGE.
  (func $gl_sw_tex_param (param $pname i32) (param $value i32)
    (local $slot i32) (local $flags i32) (local $bit i32)
    (local.set $slot (call $gl_sw_tex_slot (i32.load offset=40 (global.get $GL_SW_STATE))))
    (if (i32.eqz (local.get $slot)) (then (return)))
    (local.set $flags (call $gl_sw_tex_flags (local.get $slot)))
    (if (i32.eq (local.get $pname) (i32.const 0x2800))
      (then
        (local.set $flags (i32.and (local.get $flags) (i32.const -2)))
        (if (i32.eq (local.get $value) (i32.const 0x2601))
          (then (local.set $flags (i32.or (local.get $flags) (i32.const 1)))))))
    (if (i32.or (i32.eq (local.get $pname) (i32.const 0x2802))
                (i32.eq (local.get $pname) (i32.const 0x2803)))
      (then
        (local.set $bit (select (i32.const 2) (i32.const 4)
          (i32.eq (local.get $pname) (i32.const 0x2802))))
        (local.set $flags (i32.and (local.get $flags) (i32.xor (local.get $bit) (i32.const -1))))
        (if (i32.or (i32.eq (local.get $value) (i32.const 0x2900))
                    (i32.eq (local.get $value) (i32.const 0x812F)))
          (then (local.set $flags (i32.or (local.get $flags) (local.get $bit)))))))
    (i32.store offset=4 (local.get $slot) (local.get $flags)))

  ;; Bytes per pixel of an 8-bit client format, 0 for one not converted.
  (func $gl_sw_format_bytes (param $format i32) (result i32)
    (if (i32.or (i32.eq (local.get $format) (i32.const 0x1908))       ;; RGBA
                (i32.eq (local.get $format) (i32.const 0x80E1)))      ;; BGRA_EXT
      (then (return (i32.const 4))))
    (if (i32.or (i32.eq (local.get $format) (i32.const 0x1907))       ;; RGB
                (i32.eq (local.get $format) (i32.const 0x80E0)))      ;; BGR_EXT
      (then (return (i32.const 3))))
    (if (i32.eq (local.get $format) (i32.const 0x190A)) (then (return (i32.const 2))))
    (if (i32.or (i32.eq (local.get $format) (i32.const 0x1909))       ;; LUMINANCE
                (i32.eq (local.get $format) (i32.const 0x1906)))      ;; ALPHA
      (then (return (i32.const 1))))
    (i32.const 0))

  ;; One client pixel as 0xAARRGGBB.
  (func $gl_sw_texel (param $p i32) (param $format i32) (result i32)
    (local $a i32) (local $r i32) (local $g i32) (local $b i32)
    (local.set $a (i32.const 255))
    (if (i32.or (i32.eq (local.get $format) (i32.const 0x1908))
                (i32.eq (local.get $format) (i32.const 0x1907)))
      (then
        (local.set $r (i32.load8_u (local.get $p)))
        (local.set $g (i32.load8_u offset=1 (local.get $p)))
        (local.set $b (i32.load8_u offset=2 (local.get $p)))
        (if (i32.eq (local.get $format) (i32.const 0x1908))
          (then (local.set $a (i32.load8_u offset=3 (local.get $p)))))))
    (if (i32.or (i32.eq (local.get $format) (i32.const 0x80E1))
                (i32.eq (local.get $format) (i32.const 0x80E0)))
      (then
        (local.set $b (i32.load8_u (local.get $p)))
        (local.set $g (i32.load8_u offset=1 (local.get $p)))
        (local.set $r (i32.load8_u offset=2 (local.get $p)))
        (if (i32.eq (local.get $format) (i32.const 0x80E1))
          (then (local.set $a (i32.load8_u offset=3 (local.get $p)))))))
    (if (i32.eq (local.get $format) (i32.const 0x1909))
      (then
        (local.set $r (i32.load8_u (local.get $p)))
        (local.set $g (local.get $r)) (local.set $b (local.get $r))))
    (if (i32.eq (local.get $format) (i32.const 0x190A))
      (then
        (local.set $r (i32.load8_u (local.get $p)))
        (local.set $g (local.get $r)) (local.set $b (local.get $r))
        (local.set $a (i32.load8_u offset=1 (local.get $p)))))
    ;; GL_ALPHA reads as (0,0,0,A) in GL 1.x's texture environment table.
    (if (i32.eq (local.get $format) (i32.const 0x1906))
      (then (local.set $a (i32.load8_u (local.get $p)))))
    (i32.or (i32.or (i32.shl (local.get $a) (i32.const 24)) (i32.shl (local.get $r) (i32.const 16)))
            (i32.or (i32.shl (local.get $g) (i32.const 8)) (local.get $b))))

  ;; An internal format with no alpha channel keeps whatever alpha the client
  ;; data carried out of the result: 3, GL_RGB and the sized RGB4..RGB16.
  (func $gl_sw_internal_opaque (param $internal i32) (result i32)
    (i32.or
      (i32.or (i32.eq (local.get $internal) (i32.const 3))
              (i32.eq (local.get $internal) (i32.const 0x1907)))
      (i32.le_u (i32.sub (local.get $internal) (i32.const 0x804F)) (i32.const 5))))

  ;; Convert a w x h rectangle of client pixels at guest $pixels into the
  ;; texture surface $entry at (x, y). Rows are $gl_sw unpack-aligned. The
  ;; whole rectangle is gathered through $guest_span_in because a texture is
  ;; routinely larger than one guest page and adjacent sparse pages need not
  ;; be adjacent in WASM memory.
  (func $gl_sw_tex_store (param $entry i32) (param $x i32) (param $y i32)
      (param $w i32) (param $h i32) (param $format i32) (param $pixels i32)
      (param $opaque i32)
    (local $bpp i32) (local $align i32) (local $stride i32) (local $len i32)
    (local $src i32) (local $row i32) (local $col i32) (local $tw i32) (local $th i32)
    (local $pitch i32) (local $dib i32) (local $dst i32) (local $px i32)
    (local.set $bpp (call $gl_sw_format_bytes (local.get $format)))
    (local.set $align (i32.load offset=44 (global.get $GL_SW_STATE)))
    (if (i32.eqz (local.get $align)) (then (local.set $align (i32.const 4))))
    (local.set $stride (i32.and
      (i32.add (i32.mul (local.get $w) (local.get $bpp)) (i32.sub (local.get $align) (i32.const 1)))
      (i32.sub (i32.const 0) (local.get $align))))
    (local.set $len (i32.mul (local.get $stride) (local.get $h)))
    (if (i32.or (i32.eqz (local.get $len)) (i32.eqz (local.get $pixels))) (then (return)))
    (local.set $tw (load.field DxObject width (local.get $entry)))
    (local.set $th (load.field DxObject height (local.get $entry)))
    (local.set $pitch (load.field DxObject pitch (local.get $entry)))
    (local.set $dib (load.field DxObject misc1 (local.get $entry)))
    (local.set $src (call $guest_span_in (local.get $pixels) (local.get $len)))
    (local.set $row (i32.const 0))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_s (local.get $row) (local.get $h)))
      (local.set $col (i32.const 0))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_s (local.get $col) (local.get $w)))
        (if (i32.and
              (i32.lt_u (i32.add (local.get $x) (local.get $col)) (local.get $tw))
              (i32.lt_u (i32.add (local.get $y) (local.get $row)) (local.get $th)))
          (then
            (local.set $px (call $gl_sw_texel
              (i32.add (local.get $src)
                (i32.add (i32.mul (local.get $row) (local.get $stride))
                         (i32.mul (local.get $col) (local.get $bpp))))
              (local.get $format)))
            (if (local.get $opaque)
              (then (local.set $px (i32.or (local.get $px) (i32.const 0xFF000000)))))
            (local.set $dst (i32.add (local.get $dib)
              (i32.add (i32.mul (i32.add (local.get $y) (local.get $row)) (local.get $pitch))
                       (i32.shl (i32.add (local.get $x) (local.get $col)) (i32.const 2)))))
            (i32.store (local.get $dst) (local.get $px))))
        (local.set $col (i32.add (local.get $col) (i32.const 1)))
        (br $cols)))
      (local.set $row (i32.add (local.get $row) (i32.const 1)))
      (br $rows)))
    (call $guest_span_release (local.get $src) (local.get $len)))

  (func $gl_sw_tex_release (param $slot i32)
    (local $obj i32)
    (local.set $obj (i32.load (local.get $slot)))
    (if (i32.eqz (local.get $obj)) (then (return)))
    (i32.store (local.get $slot) (i32.const 0))
    (drop (call $dx_surface_release (local.get $obj))))

  ;; glTexImage2D / gluBuild2DMipmaps level 0 into the bound name. Mip levels
  ;; above 0 are not stored: the rasterizer samples one level.
  (func $gl_sw_tex_image (param $level i32) (param $internal i32)
      (param $w i32) (param $h i32) (param $format i32) (param $type i32)
      (param $pixels i32)
    (local $slot i32) (local $obj i32) (local $entry i32) (local $opaque i32)
    (if (local.get $level) (then (return)))
    (local.set $slot (call $gl_sw_tex_slot (i32.load offset=40 (global.get $GL_SW_STATE))))
    (if (i32.eqz (local.get $slot)) (then (return)))
    (drop (call $gl_sw_tex_flags (local.get $slot)))
    (call $gl_sw_tex_release (local.get $slot))
    (if (i32.or (i32.ne (local.get $type) (i32.const 0x1401))           ;; UNSIGNED_BYTE
                (i32.eqz (call $gl_sw_format_bytes (local.get $format))))
      (then
        (global.set $gl_sw_tex_unsupported
          (i32.add (global.get $gl_sw_tex_unsupported) (i32.const 1)))
        (return)))
    (if (i32.or (i32.lt_s (local.get $w) (i32.const 1)) (i32.lt_s (local.get $h) (i32.const 1)))
      (then (return)))
    (if (i32.or (i32.gt_s (local.get $w) (i32.const 4096)) (i32.gt_s (local.get $h) (i32.const 4096)))
      (then (return)))
    (local.set $obj (call $d3d9_create_surface (local.get $w) (local.get $h)
      (i32.const 32) (i32.const 4)))
    (if (i32.eqz (local.get $obj)) (then (return)))
    (local.set $entry (call $dx_from_this (local.get $obj)))
    (call $dx_surf_fmt_set (local.get $entry) (i32.const 5))       ;; ARGB8888
    (i32.store (local.get $slot) (local.get $obj))
    (local.set $opaque (call $gl_sw_internal_opaque (local.get $internal)))
    ;; The opaque decision is re-derived at sub-image time from this bit.
    (i32.store offset=4 (local.get $slot) (i32.or
      (i32.and (i32.load offset=4 (local.get $slot)) (i32.const 15))
      (i32.shl (local.get $opaque) (i32.const 4))))
    (call $gl_sw_tex_store (local.get $entry) (i32.const 0) (i32.const 0)
      (local.get $w) (local.get $h) (local.get $format) (local.get $pixels)
      (local.get $opaque))
    (global.set $gl_sw_tex_uploads (i32.add (global.get $gl_sw_tex_uploads) (i32.const 1))))

  (func $gl_sw_tex_sub_image (param $level i32) (param $x i32) (param $y i32)
      (param $w i32) (param $h i32) (param $format i32) (param $type i32)
      (param $pixels i32)
    (local $slot i32) (local $obj i32)
    (if (local.get $level) (then (return)))
    (local.set $slot (call $gl_sw_tex_slot (i32.load offset=40 (global.get $GL_SW_STATE))))
    (if (i32.eqz (local.get $slot)) (then (return)))
    (local.set $obj (i32.load (local.get $slot)))
    (if (i32.eqz (local.get $obj)) (then (return)))
    (if (i32.or (i32.ne (local.get $type) (i32.const 0x1401))
                (i32.eqz (call $gl_sw_format_bytes (local.get $format))))
      (then
        (global.set $gl_sw_tex_unsupported
          (i32.add (global.get $gl_sw_tex_unsupported) (i32.const 1)))
        (return)))
    (if (i32.or (i32.lt_s (local.get $x) (i32.const 0)) (i32.lt_s (local.get $y) (i32.const 0)))
      (then (return)))
    (call $gl_sw_tex_store (call $dx_from_this (local.get $obj))
      (local.get $x) (local.get $y) (local.get $w) (local.get $h)
      (local.get $format) (local.get $pixels)
      (i32.ne (i32.and (i32.load offset=4 (local.get $slot)) (i32.const 16)) (i32.const 0))))

  (func $gl_sw_delete_textures (param $n i32) (param $names i32)
    (local $i i32) (local $slot i32)
    (if (i32.or (i32.le_s (local.get $n) (i32.const 0)) (i32.eqz (local.get $names)))
      (then (return)))
    (block $done (loop $lp
      (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $slot (call $gl_sw_tex_slot
        (call $gl32 (i32.add (local.get $names) (i32.shl (local.get $i) (i32.const 2))))))
      (if (local.get $slot)
        (then
          (call $gl_sw_tex_release (local.get $slot))
          (i32.store offset=4 (local.get $slot) (i32.const 0))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $lp))))

  ;; ---- small helpers ------------------------------------------------------
  (func $gl_sw_clip_at (param $k i32) (result i32)
    (i32.add (global.get $GL_SW_SCRATCH)
      (i32.add (i32.const 64) (i32.mul (local.get $k) (i32.const 16)))))
  ;; Per-vertex screen record, 32 bytes: +0 x, +4 y (i32), +8 z, +12 rhw,
  ;; +16 u, +20 v (f32), +24 colour (0xAARRGGBB).
  (func $gl_sw_screen_at (param $k i32) (result i32)
    (i32.add (global.get $GL_SW_SCRATCH)
      (i32.add (i32.const 128) (i32.mul (local.get $k) (i32.const 32)))))

  ;; A GL colour component (f32, nominally 0..1) as a byte.
  (func $gl_sw_u8 (param $f f32) (result i32)
    (if (f32.ne (local.get $f) (local.get $f)) (then (return (i32.const 0))))
    (if (f32.le (local.get $f) (f32.const 0)) (then (return (i32.const 0))))
    (if (f32.ge (local.get $f) (f32.const 1)) (then (return (i32.const 255))))
    ;; trunc_sat and not trunc: a guest float reaches this, and a plain
    ;; i32.trunc_f32_s traps the whole module on a value the guards above
    ;; have not already excluded.
    (i32.trunc_sat_f32_s (f32.add (f32.mul (local.get $f) (f32.const 255)) (f32.const 0.5))))

  ;; The 56-byte GL vertex at $v carries r,g,b,a as f32 at +12..+24. The
  ;; rasterizer wants one D3DCOLOR.
  (func $gl_sw_color (param $v i32) (result i32)
    (i32.or
      (i32.or
        (i32.shl (call $gl_sw_u8 (f32.load offset=24 (local.get $v))) (i32.const 24))
        (i32.shl (call $gl_sw_u8 (f32.load offset=12 (local.get $v))) (i32.const 16)))
      (i32.or
        (i32.shl (call $gl_sw_u8 (f32.load offset=16 (local.get $v))) (i32.const 8))
        (call $gl_sw_u8 (f32.load offset=20 (local.get $v))))))

  ;; A screen coordinate, saturated into a range the span walker can loop
  ;; over. The rasterizer clips each span, but it still iterates y from the
  ;; top vertex to the bottom one, so an unbounded coordinate is a hang
  ;; rather than a wrong pixel.
  (func $gl_sw_coord (param $f f32) (result i32)
    (if (f32.ne (local.get $f) (local.get $f)) (then (return (i32.const 0))))
    (if (f32.le (local.get $f) (f32.const -16384)) (then (return (i32.const -16384))))
    (if (f32.ge (local.get $f) (f32.const 16384)) (then (return (i32.const 16384))))
    (i32.trunc_sat_f32_s (f32.floor (f32.add (local.get $f) (f32.const 0.5)))))

  ;; Perspective divide, viewport map and depth-range map for one clip-space
  ;; vertex, written into its screen record.
  (func $gl_sw_project (param $clip i32) (param $vp i32) (param $out i32)
    (local $w f32) (local $rhw f32) (local $n f32) (local $f f32) (local $b i32)
    (local.set $w (f32.load offset=12 (local.get $clip)))
    (local.set $rhw (f32.div (f32.const 1) (local.get $w)))
    (i32.store (local.get $out) (i32.add (i32.load (local.get $vp))
      (call $gl_sw_coord (f32.mul
        (f32.mul (f32.add (f32.mul (f32.load (local.get $clip)) (local.get $rhw))
                          (f32.const 1))
                 (f32.const 0.5))
        (f32.convert_i32_s (i32.load offset=8 (local.get $vp)))))))
    ;; GL's window origin is bottom-left and a DIB surface's is top-left, so y
    ;; is flipped here and nowhere else. glViewport's y is also bottom-up.
    (i32.store offset=4 (local.get $out)
      (i32.sub
        (i32.sub (load.field DxObject height (global.get $gl_sw_rt))
                 (i32.load offset=4 (local.get $vp)))
        (call $gl_sw_coord (f32.mul
          (f32.mul (f32.add (f32.mul (f32.load offset=4 (local.get $clip)) (local.get $rhw))
                            (f32.const 1))
                   (f32.const 0.5))
          (f32.convert_i32_s (i32.load offset=12 (local.get $vp)))))))
    ;; glDepthRange, which the mirror keeps beside the viewport. A block never
    ;; given one reads (0,0); that is legal GL but also exactly what "never
    ;; set" looks like, and far more often the latter, so it reads as (0,1).
    (local.set $b (call $gl_mtx_block))
    (local.set $n (f32.load offset=9024 (local.get $b)))
    (local.set $f (f32.load offset=9028 (local.get $b)))
    (if (i32.and (f32.eq (local.get $n) (f32.const 0)) (f32.eq (local.get $f) (f32.const 0)))
      (then (local.set $f (f32.const 1))))
    (f32.store offset=8 (local.get $out)
      (f32.add (local.get $n) (f32.mul (f32.sub (local.get $f) (local.get $n))
        (f32.mul (f32.add (f32.mul (f32.load offset=8 (local.get $clip)) (local.get $rhw))
                          (f32.const 1))
                 (f32.const 0.5)))))
    (f32.store offset=12 (local.get $out) (local.get $rhw)))

  ;; ---- surfaces -----------------------------------------------------------
  ;; The surface GL software draws land on, created on first use at the
  ;; viewport's size, with its depth surface. Flags 1 marks it primary
  ;; because a GL app has no other primary -- that is what makes a --png
  ;; capture and the browser present path find it without being told a slot.
  (func $gl_sw_target (result i32)
    (local $vp i32) (local $w i32) (local $h i32) (local $obj i32) (local $px i32)
    (if (global.get $gl_sw_rt) (then (return (global.get $gl_sw_rt))))
    (local.set $vp (call $gl_mtx_export_viewport_ptr))
    (local.set $w (i32.add (i32.load (local.get $vp)) (i32.load offset=8 (local.get $vp))))
    (local.set $h (i32.add (i32.load offset=4 (local.get $vp)) (i32.load offset=12 (local.get $vp))))
    ;; A context given no glViewport yet reports all zeroes; fall back to the
    ;; 640x480 the rest of the DX path defaults to rather than a zero-sized
    ;; surface, and refuse the absurd rather than allocate it.
    (if (i32.or (i32.lt_s (local.get $w) (i32.const 1))
                (i32.gt_s (local.get $w) (i32.const 4096)))
      (then (local.set $w (i32.const 640))))
    (if (i32.or (i32.lt_s (local.get $h) (i32.const 1))
                (i32.gt_s (local.get $h) (i32.const 4096)))
      (then (local.set $h (i32.const 480))))
    ;; Front first: it is the primary a capture or the browser shows, and a
    ;; front without a back is still a picture, where the reverse is not.
    (local.set $obj (call $d3d9_create_surface
      (local.get $w) (local.get $h) (i32.const 32) (i32.const 1)))
    (if (i32.eqz (local.get $obj)) (then (return (i32.const 0))))
    (global.set $gl_sw_front (call $dx_from_this (local.get $obj)))
    (local.set $obj (call $d3d9_create_surface
      (local.get $w) (local.get $h) (i32.const 32) (i32.const 4)))
    (if (i32.eqz (local.get $obj)) (then (return (i32.const 0))))
    (global.set $gl_sw_rt (call $dx_from_this (local.get $obj)))
    ;; 16bpp depth: the rasterizer stores z * 65535, so a clear to all-ones
    ;; bytes is exactly GL's default clear depth of 1.0.
    (local.set $obj (call $d3d9_create_surface
      (local.get $w) (local.get $h) (i32.const 16) (i32.const 4)))
    (if (local.get $obj)
      (then
        (global.set $gl_sw_zbuf (call $dx_from_this (local.get $obj)))
        (call $gl_sw_clear_depth)))
    (if (i32.eqz (global.get $gl_sw_white))
      (then
        (local.set $obj (call $d3d9_create_surface (i32.const 1) (i32.const 1)
          (i32.const 32) (i32.const 4)))
        (if (local.get $obj)
          (then
            (global.set $gl_sw_white (call $dx_from_this (local.get $obj)))
            (call $dx_surf_fmt_set (global.get $gl_sw_white) (i32.const 5))
            (i32.store (load.field DxObject misc1 (global.get $gl_sw_white))
              (i32.const 0xFFFFFFFF))))))
    (global.get $gl_sw_rt))

  (func $gl_sw_clear_depth
    (local $z i32)
    (local.set $z (global.get $gl_sw_zbuf))
    (if (i32.eqz (local.get $z)) (then (return)))
    (memory.fill (load.field DxObject misc1 (local.get $z)) (i32.const 0xFF)
      (i32.mul (load.field DxObject pitch (local.get $z))
               (load.field DxObject height (local.get $z)))))

  ;; ---- the call stream ------------------------------------------------------
  ;; Every GL call on its way into the stream, seen beside $gl_mtx_observe.
  ;; Only calls that change what the software target holds are read. Argument
  ;; i of a call lives at $stack + 4 + 4*i; GLfloat arguments are f32 there.
  (func $gl_sw_observe (param $op i32) (param $stack i32)
    (local $s i32) (local $rt i32) (local $bit i32) (local $mask i32)
    (if (i32.eqz (global.get $gl_sw_enabled)) (then (return)))
    (local.set $s (global.get $GL_SW_STATE))
    ;; 10 glEnable / 8 glDisable
    (if (i32.or (i32.eq (local.get $op) (i32.const 10)) (i32.eq (local.get $op) (i32.const 8)))
      (then
        (local.set $bit (call $gl_sw_cap_bit (i32.load offset=4 (local.get $stack))))
        (i32.store (local.get $s) (select
          (i32.or (i32.load (local.get $s)) (local.get $bit))
          (i32.and (i32.load (local.get $s)) (i32.xor (local.get $bit) (i32.const -1)))
          (i32.eq (local.get $op) (i32.const 10))))
        (return)))
    ;; 1 glBlendFunc(src, dst)
    (if (i32.eq (local.get $op) (i32.const 1))
      (then
        (i32.store offset=4 (local.get $s)
          (call $gl_sw_blend (i32.load offset=4 (local.get $stack)) (i32.const 2)))
        (i32.store offset=8 (local.get $s)
          (call $gl_sw_blend (i32.load offset=8 (local.get $stack)) (i32.const 1)))
        (return)))
    ;; 0 glAlphaFunc(func, GLclampf ref)
    (if (i32.eqz (local.get $op))
      (then
        (i32.store offset=12 (local.get $s) (call $gl_sw_cmp (i32.load offset=4 (local.get $stack))))
        (i32.store offset=16 (local.get $s) (call $gl_sw_u8 (f32.load offset=8 (local.get $stack))))
        (return)))
    ;; 5 glDepthFunc, 6 glDepthMask, 4 glCullFace, 81 glFrontFace
    (if (i32.eq (local.get $op) (i32.const 5))
      (then (i32.store offset=20 (local.get $s) (call $gl_sw_cmp (i32.load offset=4 (local.get $stack))))
        (return)))
    (if (i32.eq (local.get $op) (i32.const 6))
      (then (i32.store offset=24 (local.get $s)
          (i32.ne (i32.and (i32.load offset=4 (local.get $stack)) (i32.const 0xFF)) (i32.const 0)))
        (return)))
    (if (i32.eq (local.get $op) (i32.const 4))
      (then (i32.store offset=28 (local.get $s) (i32.load offset=4 (local.get $stack))) (return)))
    (if (i32.eq (local.get $op) (i32.const 81))
      (then (i32.store offset=32 (local.get $s)
          (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x901)))
        (return)))
    ;; 44 glTexEnvf / 82 glTexEnvi (GL_TEXTURE_ENV, GL_TEXTURE_ENV_MODE, mode).
    ;; REPLACE and DECAL both take the texture's colour; DECAL's blend by
    ;; texture alpha is not modelled.
    (if (i32.or (i32.eq (local.get $op) (i32.const 44)) (i32.eq (local.get $op) (i32.const 82)))
      (then
        (if (i32.eq (i32.load offset=8 (local.get $stack)) (i32.const 0x2200))
          (then
            (local.set $mask (select
              (i32.trunc_sat_f32_s (f32.load offset=12 (local.get $stack)))
              (i32.load offset=12 (local.get $stack))
              (i32.eq (local.get $op) (i32.const 44))))
            (i32.store offset=36 (local.get $s)
              (select (i32.const 2) (i32.const 4)
                (i32.or (i32.eq (local.get $mask) (i32.const 0x1E01))
                        (i32.eq (local.get $mask) (i32.const 0x2101)))))))
        (return)))
    ;; 42 glBindTexture(target, name), TEXTURE_2D only.
    (if (i32.eq (local.get $op) (i32.const 42))
      (then
        (if (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x0DE1))
          (then (i32.store offset=40 (local.get $s) (i32.load offset=8 (local.get $stack)))))
        (return)))
    ;; 46 glTexParameterf / 96 glTexParameteri
    (if (i32.or (i32.eq (local.get $op) (i32.const 46)) (i32.eq (local.get $op) (i32.const 96)))
      (then
        (if (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x0DE1))
          (then (call $gl_sw_tex_param (i32.load offset=8 (local.get $stack))
            (select
              (i32.trunc_sat_f32_s (f32.load offset=12 (local.get $stack)))
              (i32.load offset=12 (local.get $stack))
              (i32.eq (local.get $op) (i32.const 46))))))
        (return)))
    ;; 45 glTexImage2D(target, level, internal, w, h, border, format, type, pixels)
    (if (i32.eq (local.get $op) (i32.const 45))
      (then
        (if (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x0DE1))
          (then (call $gl_sw_tex_image
            (i32.load offset=8 (local.get $stack)) (i32.load offset=12 (local.get $stack))
            (i32.load offset=16 (local.get $stack)) (i32.load offset=20 (local.get $stack))
            (i32.load offset=28 (local.get $stack)) (i32.load offset=32 (local.get $stack))
            (i32.load offset=36 (local.get $stack)))))
        (return)))
    ;; 61 gluBuild2DMipmaps(target, components, w, h, format, type, data)
    (if (i32.eq (local.get $op) (i32.const 61))
      (then
        (if (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x0DE1))
          (then (call $gl_sw_tex_image (i32.const 0)
            (i32.load offset=8 (local.get $stack))
            (i32.load offset=12 (local.get $stack)) (i32.load offset=16 (local.get $stack))
            (i32.load offset=20 (local.get $stack)) (i32.load offset=24 (local.get $stack))
            (i32.load offset=28 (local.get $stack)))))
        (return)))
    ;; 47 glTexSubImage2D(target, level, x, y, w, h, format, type, pixels)
    (if (i32.eq (local.get $op) (i32.const 47))
      (then
        (if (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x0DE1))
          (then (call $gl_sw_tex_sub_image
            (i32.load offset=8 (local.get $stack))
            (i32.load offset=12 (local.get $stack)) (i32.load offset=16 (local.get $stack))
            (i32.load offset=20 (local.get $stack)) (i32.load offset=24 (local.get $stack))
            (i32.load offset=28 (local.get $stack)) (i32.load offset=32 (local.get $stack))
            (i32.load offset=36 (local.get $stack)))))
        (return)))
    ;; 43 glDeleteTextures(n, names)
    (if (i32.eq (local.get $op) (i32.const 43))
      (then (call $gl_sw_delete_textures (i32.load offset=4 (local.get $stack))
          (i32.load offset=8 (local.get $stack)))
        (return)))
    ;; 73 glPixelStorei(GL_UNPACK_ALIGNMENT, n)
    (if (i32.eq (local.get $op) (i32.const 73))
      (then
        (if (i32.eq (i32.load offset=4 (local.get $stack)) (i32.const 0x0CF5))
          (then
            (local.set $mask (i32.load offset=8 (local.get $stack)))
            (if (i32.or (i32.or (i32.eq (local.get $mask) (i32.const 1)) (i32.eq (local.get $mask) (i32.const 2)))
                        (i32.or (i32.eq (local.get $mask) (i32.const 4)) (i32.eq (local.get $mask) (i32.const 8))))
              (then (i32.store offset=44 (local.get $s) (local.get $mask))))))
        (return)))
    ;; 76 glPushAttrib(mask) / 77 glPopAttrib
    (if (i32.eq (local.get $op) (i32.const 76))
      (then (call $gl_sw_push_attrib (i32.load offset=4 (local.get $stack))) (return)))
    (if (i32.eq (local.get $op) (i32.const 77))
      (then (call $gl_sw_pop_attrib) (return)))
    ;; 3 glClearColor(four GLclampf)
    (if (i32.eq (local.get $op) (i32.const 3))
      (then
        (global.set $gl_sw_clear_color (i32.or
          (i32.or
            (i32.shl (call $gl_sw_u8 (f32.load offset=16 (local.get $stack))) (i32.const 24))
            (i32.shl (call $gl_sw_u8 (f32.load offset=4 (local.get $stack))) (i32.const 16)))
          (i32.or
            (i32.shl (call $gl_sw_u8 (f32.load offset=8 (local.get $stack))) (i32.const 8))
            (call $gl_sw_u8 (f32.load offset=12 (local.get $stack))))))
        (return)))
    ;; 55 SwapBuffers / wglSwapLayerBuffers: the back buffer becomes the
    ;; picture. The back keeps its contents, which GL leaves undefined and
    ;; every app we run clears anyway.
    (if (i32.eq (local.get $op) (i32.const 55))
      (then
        (if (i32.and (i32.ne (global.get $gl_sw_rt) (i32.const 0))
                     (i32.ne (global.get $gl_sw_front) (i32.const 0)))
          (then
            (call $memcpy (load.field DxObject misc1 (global.get $gl_sw_front))
              (load.field DxObject misc1 (global.get $gl_sw_rt))
              (i32.mul (load.field DxObject pitch (global.get $gl_sw_rt))
                       (load.field DxObject height (global.get $gl_sw_rt))))
            (global.set $gl_sw_presents (i32.add (global.get $gl_sw_presents) (i32.const 1)))))
        (return)))
    ;; 2 glClear(mask): COLOR_BUFFER_BIT 0x4000, DEPTH_BUFFER_BIT 0x100.
    (if (i32.eq (local.get $op) (i32.const 2))
      (then
        (local.set $mask (i32.load offset=4 (local.get $stack)))
        (local.set $rt (call $gl_sw_target))
        (if (i32.eqz (local.get $rt)) (then (return)))
        (if (i32.and (local.get $mask) (i32.const 0x4000))
          (then (call $viewport_fill_rect (local.get $rt) (i32.const 0) (i32.const 0)
            (load.field DxObject width (local.get $rt))
            (load.field DxObject height (local.get $rt))
            (global.get $gl_sw_clear_color))))
        (if (i32.and (local.get $mask) (i32.const 0x100))
          (then (call $gl_sw_clear_depth))))))

  ;; ---- triangles ----------------------------------------------------------
  ;; One triangle: three 56-byte GL vertices starting at $v0.
  (func $gl_sw_triangle (param $mvp i32) (param $vp i32) (param $v0 i32)
    (local $k i32) (local $src i32) (local $clip i32) (local $tmp i32) (local $out i32)
    (local $s i32) (local $caps i32) (local $area i32) (local $front i32) (local $cull i32)
    (local $slot i32) (local $tex i32) (local $flags i32) (local $alpha_test i32)
    (local $zbuf i32) (local $s0 i32) (local $s1 i32) (local $s2 i32) (local $flat i32)
    (local.set $tmp (region.addr $GL_SW_SCRATCH 112))
    (local.set $k (i32.const 0))
    (loop $lp
      (local.set $src (i32.add (local.get $v0) (i32.mul (local.get $k) (i32.const 56))))
      (call $gl_mtx_set4 (local.get $tmp)
        (f32.load (local.get $src))
        (f32.load offset=4 (local.get $src))
        (f32.load offset=8 (local.get $src))
        (f32.const 1))
      (local.set $clip (call $gl_sw_clip_at (local.get $k)))
      (call $gl_mtx_transform4 (local.get $clip) (local.get $mvp) (local.get $tmp))
      ;; A vertex at or behind the eye plane has no screen position. Near-plane
      ;; clipping is not built yet, so the triangle is dropped whole: dividing
      ;; by a negative w mirrors the geometry about the origin and draws a
      ;; convincing wrong picture instead of an obviously absent one.
      (if (f32.le (f32.load offset=12 (local.get $clip)) (f32.const 0.0001))
        (then
          (global.set $gl_sw_clipped (i32.add (global.get $gl_sw_clipped) (i32.const 1)))
          (return)))
      (local.set $out (call $gl_sw_screen_at (local.get $k)))
      (call $gl_sw_project (local.get $clip) (local.get $vp) (local.get $out))
      (f32.store offset=16 (local.get $out) (f32.load offset=28 (local.get $src)))
      (f32.store offset=20 (local.get $out) (f32.load offset=32 (local.get $src)))
      (i32.store offset=24 (local.get $out) (call $gl_sw_color (local.get $src)))
      (local.set $k (i32.add (local.get $k) (i32.const 1)))
      (br_if $lp (i32.lt_u (local.get $k) (i32.const 3))))
    (local.set $s (global.get $GL_SW_STATE))
    (local.set $caps (i32.load (local.get $s)))
    (local.set $s0 (call $gl_sw_screen_at (i32.const 0)))
    (local.set $s1 (call $gl_sw_screen_at (i32.const 1)))
    (local.set $s2 (call $gl_sw_screen_at (i32.const 2)))
    ;; Face culling. In screen space (y down) a triangle GL calls CCW has a
    ;; negative signed area, because the y flip reverses every winding.
    (if (i32.and (local.get $caps) (i32.const 16))
      (then
        (local.set $area (i32.sub
          (i32.mul (i32.sub (i32.load (local.get $s1)) (i32.load (local.get $s0)))
                   (i32.sub (i32.load offset=4 (local.get $s2)) (i32.load offset=4 (local.get $s0))))
          (i32.mul (i32.sub (i32.load (local.get $s2)) (i32.load (local.get $s0)))
                   (i32.sub (i32.load offset=4 (local.get $s1)) (i32.load offset=4 (local.get $s0))))))
        (local.set $front (i32.eq (i32.lt_s (local.get $area) (i32.const 0))
                                  (i32.load offset=32 (local.get $s))))
        (local.set $cull (i32.load offset=28 (local.get $s)))
        (if (i32.or
              (i32.eq (local.get $cull) (i32.const 0x408))
              (i32.or
                (i32.and (i32.eq (local.get $cull) (i32.const 0x405)) (i32.eqz (local.get $front)))
                (i32.and (i32.eq (local.get $cull) (i32.const 0x404)) (local.get $front))))
          (then
            (global.set $gl_sw_culled (i32.add (global.get $gl_sw_culled) (i32.const 1)))
            (return)))))
    ;; GL_FLAT takes every colour from the provoking vertex, which for a GL
    ;; triangle is the LAST one.
    (if (i32.eq (global.get $gl_shade_model) (i32.const 0x1D00))
      (then
        (i32.store offset=24 (local.get $s0) (i32.load offset=24 (local.get $s2)))
        (i32.store offset=24 (local.get $s1) (i32.load offset=24 (local.get $s2)))))
    ;; Texture: the bound name's surface when TEXTURE_2D is on and it has an
    ;; image, otherwise the white texel, which MODULATE reduces to the
    ;; vertex colour.
    (local.set $tex (global.get $gl_sw_white))
    (local.set $flags (i32.const 9))
    (if (i32.and (local.get $caps) (i32.const 1))
      (then
        (local.set $slot (call $gl_sw_tex_slot (i32.load offset=40 (local.get $s))))
        (if (local.get $slot)
          (then (if (i32.load (local.get $slot))
            (then
              (local.set $tex (call $dx_from_this (i32.load (local.get $slot))))
              (local.set $flags (call $gl_sw_tex_flags (local.get $slot)))))))))
    (if (i32.eqz (local.get $tex)) (then (return)))
    (if (i32.and (i32.ne (i32.and (local.get $caps) (i32.const 4)) (i32.const 0))
                 (i32.ne (i32.load offset=12 (local.get $s)) (i32.const 8)))
      (then (local.set $alpha_test (i32.or (i32.load offset=12 (local.get $s))
        (i32.shl (i32.load offset=16 (local.get $s)) (i32.const 8))))))
    (if (i32.and (local.get $caps) (i32.const 8))
      (then (local.set $zbuf (global.get $gl_sw_zbuf))))
    (global.set $gl_sw_triangles (i32.add (global.get $gl_sw_triangles) (i32.const 1)))
    (call $rasterize_triangle_textured
      (global.get $gl_sw_rt) (local.get $tex)
      (i32.ne (i32.and (local.get $caps) (i32.const 2)) (i32.const 0))
      (i32.load offset=4 (local.get $s)) (i32.load offset=8 (local.get $s))
      ;; D3DTADDRESS: 1 WRAP, 3 CLAMP.
      (select (i32.const 3) (i32.const 1) (i32.ne (i32.and (local.get $flags) (i32.const 2)) (i32.const 0)))
      (select (i32.const 3) (i32.const 1) (i32.ne (i32.and (local.get $flags) (i32.const 4)) (i32.const 0)))
      (i32.and (local.get $flags) (i32.const 1))
      ;; An untextured draw modulates white by the vertex colour whatever
      ;; the texture env says; REPLACE on white would erase the colour.
      (select (i32.const 4) (i32.load offset=36 (local.get $s))
        (i32.eq (local.get $tex) (global.get $gl_sw_white)))
      (select (i32.const 4) (i32.load offset=36 (local.get $s))
        (i32.eq (local.get $tex) (global.get $gl_sw_white)))
      (i32.const 0)                                  ;; no colour key in GL
      (local.get $alpha_test)
      (i32.const 0) (i32.const 0)                    ;; dither, antialias
      (i32.load (local.get $s0)) (i32.load offset=4 (local.get $s0))
      (f32.load offset=16 (local.get $s0)) (f32.load offset=20 (local.get $s0))
      (f32.load offset=12 (local.get $s0)) (i32.load offset=24 (local.get $s0))
      (f32.load offset=8 (local.get $s0))
      (i32.load (local.get $s1)) (i32.load offset=4 (local.get $s1))
      (f32.load offset=16 (local.get $s1)) (f32.load offset=20 (local.get $s1))
      (f32.load offset=12 (local.get $s1)) (i32.load offset=24 (local.get $s1))
      (f32.load offset=8 (local.get $s1))
      (i32.load (local.get $s2)) (i32.load offset=4 (local.get $s2))
      (f32.load offset=16 (local.get $s2)) (f32.load offset=20 (local.get $s2))
      (f32.load offset=12 (local.get $s2)) (i32.load offset=24 (local.get $s2))
      (f32.load offset=8 (local.get $s2))
      (local.get $zbuf)
      (i32.load offset=20 (local.get $s))
      (i32.load offset=24 (local.get $s))))

  ;; Called from $gl_packed_finish once a packed draw record is complete.
  ;; That is the one funnel every immediate-mode and vertex-array path goes
  ;; through, and by the time it runs the topology has already been expanded
  ;; down to points, lines and triangles.
  (func $gl_sw_consume (param $start i32) (param $vertices i32)
    (local $b i32) (local $mvp i32) (local $vp i32) (local $i i32) (local $base i32)
    (if (i32.eqz (global.get $gl_sw_enabled)) (then (return)))
    ;; Modes 0 and 1 are points and lines; only triangles are lowered so far.
    (if (i32.ne (i32.load offset=8 (local.get $start)) (i32.const 4)) (then (return)))
    (if (i32.lt_u (local.get $vertices) (i32.const 3)) (then (return)))
    ;; State we know we failed to track produces a confident wrong picture;
    ;; refusing is the same contract $gl_dfx1_transform holds to.
    (if (call $gl_mtx_export_untrusted) (then (return)))
    (if (i32.eqz (call $gl_sw_target)) (then (return)))
    (local.set $b (call $gl_mtx_block))
    (local.set $mvp (global.get $GL_SW_SCRATCH))
    ;; Stacks BY NAME -- 0 modelview, 1 projection -- and not "the current
    ;; matrix", which is correct only for as long as an app happens to leave
    ;; GL_MODELVIEW selected.
    (call $gl_mtx_mul_into (local.get $mvp)
      (call $gl_mtx_stack_top (local.get $b) (i32.const 1))
      (call $gl_mtx_stack_top (local.get $b) (i32.const 0)))
    (local.set $vp (call $gl_mtx_export_viewport_ptr))
    (local.set $base (i32.add (local.get $start) (i32.const 32)))
    (local.set $i (i32.const 0))
    (block $done (loop $lp
      (br_if $done (i32.gt_u (i32.add (local.get $i) (i32.const 3)) (local.get $vertices)))
      (call $gl_sw_triangle (local.get $mvp) (local.get $vp)
        (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const 56))))
      (local.set $i (i32.add (local.get $i) (i32.const 3)))
      (br $lp))))

  ;; ---- exports --------------------------------------------------------------
  (func $gl_sw_export_set_enabled (export "gl_sw_set_enabled") (param $on i32)
    (if (i32.and (i32.ne (local.get $on) (i32.const 0)) (i32.eqz (global.get $gl_sw_enabled)))
      (then (call $gl_sw_state_defaults)))
    (global.set $gl_sw_enabled (i32.ne (local.get $on) (i32.const 0))))
  (func $gl_sw_export_enabled (export "gl_sw_enabled") (result i32)
    (global.get $gl_sw_enabled))
  (func $gl_sw_export_triangles (export "gl_sw_triangles") (result i32)
    (global.get $gl_sw_triangles))
  (func $gl_sw_export_clipped (export "gl_sw_clipped") (result i32)
    (global.get $gl_sw_clipped))
  (func $gl_sw_export_culled (export "gl_sw_culled") (result i32)
    (global.get $gl_sw_culled))
  (func $gl_sw_export_tex_uploads (export "gl_sw_tex_uploads") (result i32)
    (global.get $gl_sw_tex_uploads))
  (func $gl_sw_export_tex_unsupported (export "gl_sw_tex_unsupported") (result i32)
    (global.get $gl_sw_tex_unsupported))
  ;; The DX slot of the presented (front) surface, or -1 before the first
  ;; draw, so a test or a capture can name it without guessing.
  (func $gl_sw_export_slot (export "gl_sw_slot") (result i32)
    (if (i32.eqz (global.get $gl_sw_front)) (then (return (i32.const -1))))
    (i32.div_u (i32.sub (global.get $gl_sw_front) (global.get $DX_OBJECTS))
               (i32.const 32)))
  ;; The back buffer's DxObject entry -- where draws land -- or 0 before the
  ;; first draw. The record is the one $d3d9_create_surface documents at
  ;; 09ad-handlers-d3d9: +12 w, +14 h, +16 bpp, +18 pitch, +20 DIB (WASM
  ;; address), +28 flags.
  (func $gl_sw_export_entry (export "gl_sw_entry") (result i32)
    (global.get $gl_sw_rt))
  (func $gl_sw_export_front (export "gl_sw_front") (result i32)
    (global.get $gl_sw_front))
  (func $gl_sw_export_presents (export "gl_sw_presents") (result i32)
    (global.get $gl_sw_presents))

  ;; Push $vertices 56-byte GL vertices through the REAL packed-draw funnel.
  ;; A test that called $gl_sw_consume directly would exercise a private copy
  ;; of the lowering and prove nothing about the hook; this goes through
  ;; $gl_packed_begin/$gl_packed_finish, which is where production draws
  ;; arrive.
  (func $gl_sw_export_emit_triangles (export "gl_sw_emit_triangles")
      (param $src i32) (param $vertices i32)
    (local $start i32)
    (if (i32.eqz (local.get $vertices)) (then (return)))
    (local.set $start (call $gl_packed_begin (i32.const 4)))
    (call $memcpy (i32.add (local.get $start) (i32.const 32))
      (local.get $src) (i32.mul (local.get $vertices) (i32.const 56)))
    (call $gl_packed_finish (local.get $start) (local.get $vertices)))

  ;; Feed one GL call to the state observer, exactly as the encoder does, so a
  ;; test can set state (glEnable, glTexImage2D...) through the real decoder.
  (func $gl_sw_export_observe (export "gl_sw_observe") (param $op i32) (param $stack i32)
    (call $gl_sw_observe (local.get $op) (local.get $stack)))

  (func $gl_sw_export_reset (export "gl_sw_reset")
    (global.set $gl_sw_rt (i32.const 0))
    (global.set $gl_sw_front (i32.const 0))
    (global.set $gl_sw_presents (i32.const 0))
    (global.set $gl_sw_zbuf (i32.const 0))
    (global.set $gl_sw_triangles (i32.const 0))
    (global.set $gl_sw_clipped (i32.const 0))
    (global.set $gl_sw_culled (i32.const 0))
    (global.set $gl_sw_clear_color (i32.const 0))
    (call $gl_sw_state_defaults))
