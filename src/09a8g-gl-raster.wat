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
  ;; crossings: $rasterize_triangle_flat writes into a DxObject surface, and
  ;; $d3d9_create_surface hands one out.  A DxObject target is also what makes
  ;; --png, --dx-surfaces, --dx-slot and the browser present path work for
  ;; free, which is the "GL render target" the survey said did not exist,
  ;; already solved by the surface record D3DIM and D3D9 share.  So this
  ;; lowers GL onto that instead: transform, divide, viewport-map, rasterize.
  ;;
  ;; WHAT IT DELIBERATELY DOES NOT DO YET.  Flat shading -- one colour per
  ;; triangle, taken from its first vertex -- no depth buffer, no texturing,
  ;; no blending, triangles only, and no near-plane clipping (a triangle with
  ;; any vertex at or behind the eye is dropped whole).  $rasterize_triangle_
  ;; textured next door already interpolates colour and Z per vertex and is
  ;; the next step; this is the vertical slice that proves the seam.
  ;;
  ;; CULLING IS OFF, AND THAT IS NOT AN OVERSIGHT.  GL_CULL_FACE is disabled
  ;; by default in GL; D3D's default is D3DCULL_CCW, which 8b227b5c made this
  ;; emulator honour.  So this must NOT route through $d3dim_draw_tl_triangle,
  ;; whose cull decision reads the D3D device render-state block -- there is
  ;; no D3D device here, and inheriting D3D's default would silently discard
  ;; half of every GL model.  It calls the rasterizer directly instead.
  ;; =========================================================================

  (global $GL_SW_SCRATCH i32 (region.addr $GL_SW_SCRATCH 0))
  (global $GL_SW_SCRATCH_SIZE i32 (region.size $GL_SW_SCRATCH))

  ;; Off unless a host asks for it: with a JS GL backend present, both paths
  ;; drawing at once is two pictures, not one.
  (global $gl_sw_enabled (mut i32) (i32.const 0))
  ;; DxObject entry address of our render target, 0 until the first draw.
  (global $gl_sw_rt (mut i32) (i32.const 0))
  ;; Triangles actually rasterized. A census, so a test and --gl-census can
  ;; tell "we drew nothing" from "we were never asked to draw".
  (global $gl_sw_triangles (mut i32) (i32.const 0))
  ;; Triangles dropped for want of near-plane clipping, counted separately so
  ;; that a scene which vanishes when the camera moves inside it is legible as
  ;; a missing feature rather than as a broken transform.
  (global $gl_sw_clipped (mut i32) (i32.const 0))

  ;; Scratch layout, all within $GL_SW_SCRATCH:
  ;;   +0    modelview-projection product (16 f32)
  ;;   +64   three clip-space vertices (3 x 4 f32)
  ;;   +112  one object-space vertex being transformed (4 f32)
  ;;   +128  three screen positions (3 x 2 i32)
  (func $gl_sw_clip_at (param $k i32) (result i32)
    (i32.add (global.get $GL_SW_SCRATCH)
      (i32.add (i32.const 64) (i32.mul (local.get $k) (i32.const 16)))))
  (func $gl_sw_screen_at (param $k i32) (result i32)
    (i32.add (global.get $GL_SW_SCRATCH)
      (i32.add (i32.const 128) (i32.mul (local.get $k) (i32.const 8)))))

  ;; A GL colour component (f32, nominally 0..1) as a byte.
  (func $gl_sw_u8 (param $f f32) (result i32)
    (if (f32.ne (local.get $f) (local.get $f)) (then (return (i32.const 0))))
    (if (f32.le (local.get $f) (f32.const 0)) (then (return (i32.const 0))))
    (if (f32.ge (local.get $f) (f32.const 1)) (then (return (i32.const 255))))
    ;; trunc_sat and not trunc: a guest float reaches this, and a plain
    ;; i32.trunc_f32_s traps the whole module on a value the guard above has
    ;; not already excluded.
    (i32.trunc_sat_f32_s (f32.mul (local.get $f) (f32.const 255))))

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
  ;; over. $rasterize_triangle_flat clips each span, but it still iterates y
  ;; from the top vertex to the bottom one, so an unbounded coordinate is a
  ;; hang rather than a wrong pixel.
  (func $gl_sw_coord (param $f f32) (result i32)
    (if (f32.ne (local.get $f) (local.get $f)) (then (return (i32.const 0))))
    (if (f32.le (local.get $f) (f32.const -16384)) (then (return (i32.const -16384))))
    (if (f32.ge (local.get $f) (f32.const 16384)) (then (return (i32.const 16384))))
    (i32.trunc_sat_f32_s (local.get $f)))

  ;; Perspective divide and viewport map for one clip-space vertex.
  (func $gl_sw_project (param $clip i32) (param $vp i32) (param $out i32)
    (local $w f32)
    (local.set $w (f32.load offset=12 (local.get $clip)))
    (i32.store (local.get $out) (i32.add (i32.load (local.get $vp))
      (call $gl_sw_coord (f32.mul
        (f32.mul (f32.add (f32.div (f32.load (local.get $clip)) (local.get $w))
                          (f32.const 1))
                 (f32.const 0.5))
        (f32.convert_i32_s (i32.load offset=8 (local.get $vp)))))))
    ;; GL's window origin is bottom-left and a DIB surface's is top-left, so y
    ;; is flipped here and nowhere else.
    (i32.store offset=4 (local.get $out) (i32.add (i32.load offset=4 (local.get $vp))
      (call $gl_sw_coord (f32.mul
        (f32.mul (f32.sub (f32.const 1)
                          (f32.div (f32.load offset=4 (local.get $clip)) (local.get $w)))
                 (f32.const 0.5))
        (f32.convert_i32_s (i32.load offset=12 (local.get $vp))))))))

  ;; The surface GL software draws land on, created on first use at the
  ;; viewport's size. Flags 1 marks it primary because a GL app has no other
  ;; primary -- that is what makes a --png capture and the browser present
  ;; path find it without being told a slot.
  (func $gl_sw_target (result i32)
    (local $vp i32) (local $w i32) (local $h i32) (local $obj i32)
    (if (global.get $gl_sw_rt) (then (return (global.get $gl_sw_rt))))
    (local.set $vp (call $gl_mtx_export_viewport_ptr))
    (local.set $w (i32.load offset=8 (local.get $vp)))
    (local.set $h (i32.load offset=12 (local.get $vp)))
    ;; A context given no glViewport yet reports all zeroes, and a u16 width
    ;; cannot hold a bogus large one; both fall back to the 640x480 the rest
    ;; of the DX path defaults to rather than to a zero-sized surface.
    (if (i32.or (i32.lt_s (local.get $w) (i32.const 1))
                (i32.gt_s (local.get $w) (i32.const 4096)))
      (then (local.set $w (i32.const 640))))
    (if (i32.or (i32.lt_s (local.get $h) (i32.const 1))
                (i32.gt_s (local.get $h) (i32.const 4096)))
      (then (local.set $h (i32.const 480))))
    (local.set $obj (call $d3d9_create_surface
      (local.get $w) (local.get $h) (i32.const 32) (i32.const 1)))
    (if (i32.eqz (local.get $obj)) (then (return (i32.const 0))))
    (global.set $gl_sw_rt (call $dx_from_this (local.get $obj)))
    (global.get $gl_sw_rt))

  ;; One triangle: three 56-byte GL vertices starting at $v0.
  (func $gl_sw_triangle (param $rt i32) (param $mvp i32) (param $vp i32) (param $v0 i32)
    (local $k i32) (local $src i32) (local $clip i32) (local $tmp i32)
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
          (global.set $gl_sw_clipped
            (i32.add (global.get $gl_sw_clipped) (i32.const 1)))
          (return)))
      (call $gl_sw_project (local.get $clip) (local.get $vp)
        (call $gl_sw_screen_at (local.get $k)))
      (local.set $k (i32.add (local.get $k) (i32.const 1)))
      (br_if $lp (i32.lt_u (local.get $k) (i32.const 3))))
    (global.set $gl_sw_triangles (i32.add (global.get $gl_sw_triangles) (i32.const 1)))
    (call $rasterize_triangle_flat
      (local.get $rt)
      (i32.load (call $gl_sw_screen_at (i32.const 0)))
      (i32.load offset=4 (call $gl_sw_screen_at (i32.const 0)))
      (i32.load (call $gl_sw_screen_at (i32.const 1)))
      (i32.load offset=4 (call $gl_sw_screen_at (i32.const 1)))
      (i32.load (call $gl_sw_screen_at (i32.const 2)))
      (i32.load offset=4 (call $gl_sw_screen_at (i32.const 2)))
      (call $gl_sw_color (local.get $v0))
      (i32.const 0)                             ;; no alpha blending yet
      (i32.const 0) (f32.const 0)               ;; no depth buffer yet
      (i32.const 0) (i32.const 0)))

  ;; Called from $gl_packed_finish once a packed draw record is complete.
  ;; That is the one funnel every immediate-mode and vertex-array path goes
  ;; through, and by the time it runs the topology has already been expanded
  ;; down to points, lines and triangles.
  (func $gl_sw_consume (param $start i32) (param $vertices i32)
    (local $rt i32) (local $b i32) (local $mvp i32) (local $vp i32) (local $i i32)
    (local $base i32)
    (if (i32.eqz (global.get $gl_sw_enabled)) (then (return)))
    ;; Modes 0 and 1 are points and lines; only triangles are lowered so far.
    (if (i32.ne (i32.load offset=8 (local.get $start)) (i32.const 4)) (then (return)))
    (if (i32.lt_u (local.get $vertices) (i32.const 3)) (then (return)))
    ;; State we know we failed to track produces a confident wrong picture;
    ;; refusing is the same contract $gl_dfx1_transform holds to.
    (if (call $gl_mtx_export_untrusted) (then (return)))
    (local.set $rt (call $gl_sw_target))
    (if (i32.eqz (local.get $rt)) (then (return)))
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
      (call $gl_sw_triangle (local.get $rt) (local.get $mvp) (local.get $vp)
        (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const 56))))
      (local.set $i (i32.add (local.get $i) (i32.const 3)))
      (br $lp))))

  (func $gl_sw_export_set_enabled (export "gl_sw_set_enabled") (param $on i32)
    (global.set $gl_sw_enabled (i32.ne (local.get $on) (i32.const 0))))
  (func $gl_sw_export_enabled (export "gl_sw_enabled") (result i32)
    (global.get $gl_sw_enabled))
  (func $gl_sw_export_triangles (export "gl_sw_triangles") (result i32)
    (global.get $gl_sw_triangles))
  (func $gl_sw_export_clipped (export "gl_sw_clipped") (result i32)
    (global.get $gl_sw_clipped))
  ;; The DX slot our target occupies, or -1 before the first draw, so a test
  ;; or a capture can name it without guessing.
  (func $gl_sw_export_slot (export "gl_sw_slot") (result i32)
    (if (i32.eqz (global.get $gl_sw_rt)) (then (return (i32.const -1))))
    (i32.div_u (i32.sub (global.get $gl_sw_rt) (global.get $DX_OBJECTS))
               (i32.const 32)))
  ;; Our render target's DxObject entry, or 0 before the first draw. The
  ;; record is the one $d3d9_create_surface documents at 09ad-handlers-d3d9:
  ;; +12 w, +14 h, +16 bpp, +18 pitch, +20 DIB (WASM address), +28 flags.
  (func $gl_sw_export_entry (export "gl_sw_entry") (result i32)
    (global.get $gl_sw_rt))

  ;; Push $vertices 56-byte GL vertices through the REAL packed-draw funnel.
  ;; A test that called $gl_sw_consume directly would exercise a private copy
  ;; of the lowering and prove nothing about the hook; this goes through
  ;; $gl_packed_begin/$gl_packed_finish, which is where production draws
  ;; arrive.  It is also the entry a non-immediate producer would use.
  (func $gl_sw_export_emit_triangles (export "gl_sw_emit_triangles")
      (param $src i32) (param $vertices i32)
    (local $start i32)
    (if (i32.eqz (local.get $vertices)) (then (return)))
    (local.set $start (call $gl_packed_begin (i32.const 4)))
    (call $memcpy (i32.add (local.get $start) (i32.const 32))
      (local.get $src) (i32.mul (local.get $vertices) (i32.const 56)))
    (call $gl_packed_finish (local.get $start) (local.get $vertices)))

  (func $gl_sw_export_reset (export "gl_sw_reset")
    (global.set $gl_sw_rt (i32.const 0))
    (global.set $gl_sw_triangles (i32.const 0))
    (global.set $gl_sw_clipped (i32.const 0)))
