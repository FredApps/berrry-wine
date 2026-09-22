  ;; OpenGL matrix stacks, owned by WAT.
  ;;
  ;; GL's transform state is the one part of the fixed-function pipeline that
  ;; still lives only in JavaScript (lib/gl-compat.js:352-354), which is why
  ;; the command stream is a log of GL calls rather than a backend-neutral
  ;; descriptor: nothing on this side knows what the matrices are, so nothing
  ;; on this side can lower a draw. See docs/gl-software-path-design.md.
  ;;
  ;; This fragment is additive. It mirrors the JS semantics exactly rather than
  ;; improving on them, so the two can be compared element-for-element while
  ;; both exist; the encoder is wired to it separately. Every arithmetic choice
  ;; here is made to match lib/gl-compat.js:112-166 bit for bit:
  ;;   - matrices are COLUMN-MAJOR, 16 f32, as Float32Array is there;
  ;;   - products accumulate in f64 and are demoted once on store, because JS
  ;;     computes in doubles and stores into a Float32Array;
  ;;   - sin/cos come from the host imports, which are the same Math.sin/cos.
  ;; The one deliberate deviation is rotation's axis length: JS uses
  ;; Math.hypot, which is more accurate than sqrt(x*x+y*y+z*z) and has no wasm
  ;; equivalent, so a rotation about a non-unit axis can differ in the last
  ;; ulp. Tests compare rotations with a tolerance for exactly this reason.
  ;;
  ;; Per-context block, 8352 bytes:
  ;;   +0    matrix mode (0x1700 MODELVIEW, 0x1701 PROJECTION, 0x1702 TEXTURE)
  ;;   +4    active texture unit (0 or 1)
  ;;   +8    depth of stack 0 (modelview), index of its top entry
  ;;   +12   depth of stack 1 (projection)
  ;;   +16   depth of stack 2 (texture unit 0)
  ;;   +20   depth of stack 3 (texture unit 1)
  ;;   +24   sticky stack error: 0, GL_STACK_OVERFLOW or GL_STACK_UNDERFLOW
  ;;   +28   reserved, 0
  ;;   +32   four stacks, 32 entries of 64 bytes each (8192 bytes)
  ;;   +8224 scratch used by a multiply whose destination aliases a source
  ;;   +8288 staging matrix a caller writes before load/mult (64 bytes)
  ;;
  ;; The depth cap is 32, which is GL's own required minimum for the modelview
  ;; stack. Real GL raises GL_STACK_OVERFLOW rather than growing, so a push
  ;; past the cap latches the error and leaves the stack alone. The JS mirror
  ;; has no cap and would keep pushing; nothing in the corpus nests that deep.

  (global $gl_mtx_contexts (mut i32) (i32.const 0))

  ;; Write a column-major identity at a 64-byte matrix slot.
  (func $gl_mtx_identity_at (param $p i32)
    (memory.fill (local.get $p) (i32.const 0) (i32.const 64))
    (f32.store offset=0 (local.get $p) (f32.const 1))
    (f32.store offset=20 (local.get $p) (f32.const 1))
    (f32.store offset=40 (local.get $p) (f32.const 1))
    (f32.store offset=60 (local.get $p) (f32.const 1)))

  ;; Base of stack $s inside block $b.
  (func $gl_mtx_base (param $b i32) (param $s i32) (result i32)
    (i32.add (local.get $b)
      (i32.add (i32.const 32) (i32.mul (local.get $s) (i32.const 2048)))))

  ;; Context blocks are looked up the way $gl_state_slot does it, and for the
  ;; same reason: a linked list matches JS Map identity with no slot ceiling.
  ;; Unlike that table these are never recycled, because a matrix stack has no
  ;; meaningful "default" to restore a reused block to.
  (func $gl_mtx_slot (param $context i32) (param $create i32) (result i32)
    (local $p i32) (local $guest i32) (local $block i32) (local $s i32)
    (local.set $p (global.get $gl_mtx_contexts))
    (block $scan_done
      (loop $scan
        (br_if $scan_done (i32.eqz (local.get $p)))
        (if (i32.eq (i32.load (local.get $p)) (local.get $context))
          (then (return (i32.load offset=8 (local.get $p)))))
        (local.set $p (i32.load offset=4 (local.get $p)))
        (br $scan)))
    (if (i32.eqz (local.get $create)) (then (return (i32.const 0))))
    (local.set $guest (call $heap_alloc (i32.const 12)))
    (if (i32.eqz (local.get $guest)) (then (unreachable)))
    (local.set $p (call $g2w (local.get $guest)))
    (local.set $guest (call $heap_alloc (i32.const 8352)))
    (if (i32.eqz (local.get $guest)) (then
      (call $heap_free (call $w2g (local.get $p))) (unreachable)))
    (local.set $block (call $g2w (local.get $guest)))
    (memory.fill (local.get $block) (i32.const 0) (i32.const 8352))
    (i32.store (local.get $block) (i32.const 0x1700))
    ;; Every stack starts one deep, holding identity.
    (local.set $s (i32.const 0))
    (loop $init
      (call $gl_mtx_identity_at
        (call $gl_mtx_base (local.get $block) (local.get $s)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $init (i32.lt_u (local.get $s) (i32.const 4))))
    (i32.store (local.get $p) (local.get $context))
    (i32.store offset=4 (local.get $p) (global.get $gl_mtx_contexts))
    (i32.store offset=8 (local.get $p) (local.get $block))
    (global.set $gl_mtx_contexts (local.get $p))
    (local.get $block))

  ;; The block for whichever context is current. $gl_current_context is the
  ;; encoder's own global (09a8c-gl-encoder.wat:22), the same one
  ;; 09a8e-gl-state.wat keys its per-context state on, so all three tables
  ;; always agree about which context a call belongs to.
  (func $gl_mtx_block (result i32)
    (call $gl_mtx_slot (global.get $gl_current_context) (i32.const 1)))

  ;; Which stack the mode and active texture unit select.
  (func $gl_mtx_sel (param $b i32) (result i32)
    (local $mode i32)
    (local.set $mode (i32.load (local.get $b)))
    (if (i32.eq (local.get $mode) (i32.const 0x1701))
      (then (return (i32.const 1))))
    (if (i32.eq (local.get $mode) (i32.const 0x1702))
      (then (return (i32.add (i32.const 2)
        (i32.ne (i32.load offset=4 (local.get $b)) (i32.const 0))))))
    (i32.const 0))

  (func $gl_mtx_depth_addr (param $b i32) (param $s i32) (result i32)
    (i32.add (local.get $b)
      (i32.add (i32.const 8) (i32.mul (local.get $s) (i32.const 4)))))

  ;; Top matrix of the selected stack.
  (func $gl_mtx_top (param $b i32) (result i32)
    (local $s i32)
    (local.set $s (call $gl_mtx_sel (local.get $b)))
    (i32.add (call $gl_mtx_base (local.get $b) (local.get $s))
      (i32.mul (i32.const 64)
        (i32.load (call $gl_mtx_depth_addr (local.get $b) (local.get $s))))))

  ;; dst = a * b, column-major, exactly as lib/gl-compat.js:120-131 spells it:
  ;;   out[col*4+row] = sum over k of a[k*4+row] * b[col*4+k]
  ;; Accumulated in f64 and demoted once, because that is what JS does when it
  ;; assigns a double expression into a Float32Array element. dst must not
  ;; alias a or b; $gl_mtx_apply routes through scratch for that case.
  (func $gl_mtx_mul_into (param $dst i32) (param $a i32) (param $bm i32)
    (local $col i32) (local $row i32) (local $k i32) (local $acc f64)
    (local.set $col (i32.const 0))
    (loop $cols
      (local.set $row (i32.const 0))
      (loop $rows
        (local.set $acc (f64.const 0))
        (local.set $k (i32.const 0))
        (loop $ks
          (local.set $acc (f64.add (local.get $acc)
            (f64.mul
              (f64.promote_f32 (f32.load (i32.add (local.get $a)
                (i32.mul (i32.const 4)
                  (i32.add (i32.mul (local.get $k) (i32.const 4))
                    (local.get $row))))))
              (f64.promote_f32 (f32.load (i32.add (local.get $bm)
                (i32.mul (i32.const 4)
                  (i32.add (i32.mul (local.get $col) (i32.const 4))
                    (local.get $k)))))))))
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br_if $ks (i32.lt_u (local.get $k) (i32.const 4))))
        (f32.store (i32.add (local.get $dst)
            (i32.mul (i32.const 4)
              (i32.add (i32.mul (local.get $col) (i32.const 4))
                (local.get $row))))
          (f32.demote_f64 (local.get $acc)))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br_if $rows (i32.lt_u (local.get $row) (i32.const 4))))
      (local.set $col (i32.add (local.get $col) (i32.const 1)))
      (br_if $cols (i32.lt_u (local.get $col) (i32.const 4)))))

  ;; top = top * m, which is what every glMultMatrix-shaped entry point does
  ;; (lib/gl-compat.js:465). The destination aliases the left operand, so the
  ;; product is formed in scratch and copied back.
  (func $gl_mtx_apply (param $b i32) (param $m i32)
    (local $top i32) (local $scratch i32)
    (local.set $top (call $gl_mtx_top (local.get $b)))
    (local.set $scratch (i32.add (local.get $b) (i32.const 8224)))
    (call $gl_mtx_mul_into (local.get $scratch) (local.get $top) (local.get $m))
    (memory.copy (local.get $top) (local.get $scratch) (i32.const 64)))

  ;; The staging matrix a caller fills before asking for a load or a multiply.
  (func $gl_mtx_staging (param $b i32) (result i32)
    (i32.add (local.get $b) (i32.const 8288)))

  (func $gl_mtx_set_mode (param $mode i32)
    (if (i32.or (i32.eq (local.get $mode) (i32.const 0x1700))
        (i32.or (i32.eq (local.get $mode) (i32.const 0x1701))
          (i32.eq (local.get $mode) (i32.const 0x1702))))
      (then (i32.store (call $gl_mtx_block) (local.get $mode)))))

  (func $gl_mtx_set_active_texture (param $unit i32)
    (i32.store offset=4 (call $gl_mtx_block)
      (i32.ne (local.get $unit) (i32.const 0))))

  (func $gl_mtx_load_identity
    (call $gl_mtx_identity_at (call $gl_mtx_top (call $gl_mtx_block))))

  (func $gl_mtx_load (param $src i32)
    (memory.copy (call $gl_mtx_top (call $gl_mtx_block))
      (local.get $src) (i32.const 64)))

  (func $gl_mtx_mult (param $src i32)
    (call $gl_mtx_apply (call $gl_mtx_block) (local.get $src)))

  ;; Push duplicates the top, as GL does. At the cap it latches
  ;; GL_STACK_OVERFLOW (0x0503) and changes nothing.
  (func $gl_mtx_push
    (local $b i32) (local $s i32) (local $d i32) (local $base i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $s (call $gl_mtx_sel (local.get $b)))
    (local.set $d (i32.load (call $gl_mtx_depth_addr (local.get $b) (local.get $s))))
    (if (i32.ge_u (local.get $d) (i32.const 31))
      (then
        (i32.store offset=24 (local.get $b) (i32.const 0x0503))
        (return)))
    (local.set $base (call $gl_mtx_base (local.get $b) (local.get $s)))
    (memory.copy
      (i32.add (local.get $base) (i32.mul (i32.const 64)
        (i32.add (local.get $d) (i32.const 1))))
      (i32.add (local.get $base) (i32.mul (i32.const 64) (local.get $d)))
      (i32.const 64))
    (i32.store (call $gl_mtx_depth_addr (local.get $b) (local.get $s))
      (i32.add (local.get $d) (i32.const 1))))

  ;; Pop refuses to empty the stack, latching GL_STACK_UNDERFLOW (0x0504).
  ;; lib/gl-compat.js:1362 refuses the same way, without the error.
  (func $gl_mtx_pop
    (local $b i32) (local $s i32) (local $d i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $s (call $gl_mtx_sel (local.get $b)))
    (local.set $d (i32.load (call $gl_mtx_depth_addr (local.get $b) (local.get $s))))
    (if (i32.eqz (local.get $d))
      (then
        (i32.store offset=24 (local.get $b) (i32.const 0x0504))
        (return)))
    (i32.store (call $gl_mtx_depth_addr (local.get $b) (local.get $s))
      (i32.sub (local.get $d) (i32.const 1))))

  ;; The generated factors below are built in the staging slot as f32, which is
  ;; what JS does (each helper returns a Float32Array), then multiplied in.

  (func $gl_mtx_translate (param $x f64) (param $y f64) (param $z f64)
    (local $b i32) (local $m i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $m (call $gl_mtx_staging (local.get $b)))
    (call $gl_mtx_identity_at (local.get $m))
    (f32.store offset=48 (local.get $m) (f32.demote_f64 (local.get $x)))
    (f32.store offset=52 (local.get $m) (f32.demote_f64 (local.get $y)))
    (f32.store offset=56 (local.get $m) (f32.demote_f64 (local.get $z)))
    (call $gl_mtx_apply (local.get $b) (local.get $m)))

  (func $gl_mtx_scale (param $x f64) (param $y f64) (param $z f64)
    (local $b i32) (local $m i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $m (call $gl_mtx_staging (local.get $b)))
    (call $gl_mtx_identity_at (local.get $m))
    (f32.store offset=0 (local.get $m) (f32.demote_f64 (local.get $x)))
    (f32.store offset=20 (local.get $m) (f32.demote_f64 (local.get $y)))
    (f32.store offset=40 (local.get $m) (f32.demote_f64 (local.get $z)))
    (call $gl_mtx_apply (local.get $b) (local.get $m)))

  (func $gl_mtx_rotate (param $angle f64) (param $x f64) (param $y f64) (param $z f64)
    (local $b i32) (local $m i32) (local $len f64)
    (local $c f64) (local $s f64) (local $t f64) (local $r f64)
    (local.set $b (call $gl_mtx_block))
    (local.set $m (call $gl_mtx_staging (local.get $b)))
    (local.set $len (f64.sqrt (f64.add
      (f64.mul (local.get $x) (local.get $x))
      (f64.add (f64.mul (local.get $y) (local.get $y))
        (f64.mul (local.get $z) (local.get $z))))))
    ;; `|| 1` in the JS: a zero-length axis leaves the components alone.
    (if (f64.eq (local.get $len) (f64.const 0))
      (then (local.set $len (f64.const 1))))
    (local.set $x (f64.div (local.get $x) (local.get $len)))
    (local.set $y (f64.div (local.get $y) (local.get $len)))
    (local.set $z (f64.div (local.get $z) (local.get $len)))
    (local.set $r (f64.div (f64.mul (local.get $angle)
      (f64.const 3.141592653589793)) (f64.const 180)))
    (local.set $c (call $host_math_cos (local.get $r)))
    (local.set $s (call $host_math_sin (local.get $r)))
    (local.set $t (f64.sub (f64.const 1) (local.get $c)))
    (memory.fill (local.get $m) (i32.const 0) (i32.const 64))
    (f32.store offset=0 (local.get $m) (f32.demote_f64 (f64.add
      (f64.mul (f64.mul (local.get $x) (local.get $x)) (local.get $t))
      (local.get $c))))
    (f32.store offset=4 (local.get $m) (f32.demote_f64 (f64.add
      (f64.mul (f64.mul (local.get $y) (local.get $x)) (local.get $t))
      (f64.mul (local.get $z) (local.get $s)))))
    (f32.store offset=8 (local.get $m) (f32.demote_f64 (f64.sub
      (f64.mul (f64.mul (local.get $z) (local.get $x)) (local.get $t))
      (f64.mul (local.get $y) (local.get $s)))))
    (f32.store offset=16 (local.get $m) (f32.demote_f64 (f64.sub
      (f64.mul (f64.mul (local.get $x) (local.get $y)) (local.get $t))
      (f64.mul (local.get $z) (local.get $s)))))
    (f32.store offset=20 (local.get $m) (f32.demote_f64 (f64.add
      (f64.mul (f64.mul (local.get $y) (local.get $y)) (local.get $t))
      (local.get $c))))
    (f32.store offset=24 (local.get $m) (f32.demote_f64 (f64.add
      (f64.mul (f64.mul (local.get $z) (local.get $y)) (local.get $t))
      (f64.mul (local.get $x) (local.get $s)))))
    (f32.store offset=32 (local.get $m) (f32.demote_f64 (f64.add
      (f64.mul (f64.mul (local.get $x) (local.get $z)) (local.get $t))
      (f64.mul (local.get $y) (local.get $s)))))
    (f32.store offset=36 (local.get $m) (f32.demote_f64 (f64.sub
      (f64.mul (f64.mul (local.get $y) (local.get $z)) (local.get $t))
      (f64.mul (local.get $x) (local.get $s)))))
    (f32.store offset=40 (local.get $m) (f32.demote_f64 (f64.add
      (f64.mul (f64.mul (local.get $z) (local.get $z)) (local.get $t))
      (local.get $c))))
    (f32.store offset=60 (local.get $m) (f32.const 1))
    (call $gl_mtx_apply (local.get $b) (local.get $m)))

  (func $gl_mtx_frustum (param $l f64) (param $r f64) (param $bo f64)
      (param $t f64) (param $n f64) (param $f f64)
    (local $b i32) (local $m i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $m (call $gl_mtx_staging (local.get $b)))
    (memory.fill (local.get $m) (i32.const 0) (i32.const 64))
    (f32.store offset=0 (local.get $m) (f32.demote_f64
      (f64.div (f64.mul (f64.const 2) (local.get $n))
        (f64.sub (local.get $r) (local.get $l)))))
    (f32.store offset=20 (local.get $m) (f32.demote_f64
      (f64.div (f64.mul (f64.const 2) (local.get $n))
        (f64.sub (local.get $t) (local.get $bo)))))
    (f32.store offset=32 (local.get $m) (f32.demote_f64
      (f64.div (f64.add (local.get $r) (local.get $l))
        (f64.sub (local.get $r) (local.get $l)))))
    (f32.store offset=36 (local.get $m) (f32.demote_f64
      (f64.div (f64.add (local.get $t) (local.get $bo))
        (f64.sub (local.get $t) (local.get $bo)))))
    (f32.store offset=40 (local.get $m) (f32.demote_f64
      (f64.neg (f64.div (f64.add (local.get $f) (local.get $n))
        (f64.sub (local.get $f) (local.get $n))))))
    (f32.store offset=44 (local.get $m) (f32.const -1))
    (f32.store offset=56 (local.get $m) (f32.demote_f64
      (f64.neg (f64.div
        (f64.mul (f64.mul (f64.const 2) (local.get $f)) (local.get $n))
        (f64.sub (local.get $f) (local.get $n))))))
    (call $gl_mtx_apply (local.get $b) (local.get $m)))

  (func $gl_mtx_ortho (param $l f64) (param $r f64) (param $bo f64)
      (param $t f64) (param $n f64) (param $f f64)
    (local $b i32) (local $m i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $m (call $gl_mtx_staging (local.get $b)))
    (call $gl_mtx_identity_at (local.get $m))
    (f32.store offset=0 (local.get $m) (f32.demote_f64
      (f64.div (f64.const 2) (f64.sub (local.get $r) (local.get $l)))))
    (f32.store offset=20 (local.get $m) (f32.demote_f64
      (f64.div (f64.const 2) (f64.sub (local.get $t) (local.get $bo)))))
    (f32.store offset=40 (local.get $m) (f32.demote_f64
      (f64.div (f64.const -2) (f64.sub (local.get $f) (local.get $n)))))
    (f32.store offset=48 (local.get $m) (f32.demote_f64
      (f64.neg (f64.div (f64.add (local.get $r) (local.get $l))
        (f64.sub (local.get $r) (local.get $l))))))
    (f32.store offset=52 (local.get $m) (f32.demote_f64
      (f64.neg (f64.div (f64.add (local.get $t) (local.get $bo))
        (f64.sub (local.get $t) (local.get $bo))))))
    (f32.store offset=56 (local.get $m) (f32.demote_f64
      (f64.neg (f64.div (f64.add (local.get $f) (local.get $n))
        (f64.sub (local.get $f) (local.get $n))))))
    (call $gl_mtx_apply (local.get $b) (local.get $m)))

  ;; Exports. These live here rather than in 13-exports.wat because nothing
  ;; outside a test calls them yet, and a fragment that owns its own test
  ;; surface is one less file to contend for.
  ;;
  ;; A test drives the stacks through these and reads the result straight out
  ;; of linear memory at gl_mtx_top_ptr, which is why no copy-out entry point
  ;; is needed. gl_mtx_staging_ptr is where a caller writes the 16 f32 of a
  ;; matrix before gl_mtx_load_src/gl_mtx_mult_src consumes it.
  (func $gl_mtx_export_top_ptr (export "gl_mtx_top_ptr") (result i32)
    (call $gl_mtx_top (call $gl_mtx_block)))
  (func $gl_mtx_export_stack_ptr (export "gl_mtx_stack_ptr")
      (param $s i32) (param $index i32) (result i32)
    (i32.add (call $gl_mtx_base (call $gl_mtx_block)
        (i32.and (local.get $s) (i32.const 3)))
      (i32.mul (i32.const 64) (i32.and (local.get $index) (i32.const 31)))))
  (func $gl_mtx_export_staging_ptr (export "gl_mtx_staging_ptr") (result i32)
    (call $gl_mtx_staging (call $gl_mtx_block)))
  (func $gl_mtx_export_depth (export "gl_mtx_depth") (param $s i32) (result i32)
    (i32.load (call $gl_mtx_depth_addr (call $gl_mtx_block)
      (i32.and (local.get $s) (i32.const 3)))))
  (func $gl_mtx_export_error (export "gl_mtx_error") (result i32)
    (i32.load offset=24 (call $gl_mtx_block)))
  (func $gl_mtx_export_clear_error (export "gl_mtx_clear_error")
    (i32.store offset=24 (call $gl_mtx_block) (i32.const 0)))
  (func $gl_mtx_export_selected (export "gl_mtx_selected") (result i32)
    (call $gl_mtx_sel (call $gl_mtx_block)))
  (func $gl_mtx_export_set_mode (export "gl_mtx_set_mode") (param $mode i32)
    (call $gl_mtx_set_mode (local.get $mode)))
  (func $gl_mtx_export_set_active_texture (export "gl_mtx_set_active_texture")
      (param $unit i32)
    (call $gl_mtx_set_active_texture (local.get $unit)))
  (func $gl_mtx_export_load_identity (export "gl_mtx_load_identity")
    (call $gl_mtx_load_identity))
  (func $gl_mtx_export_load_src (export "gl_mtx_load_src")
    (call $gl_mtx_load (call $gl_mtx_staging (call $gl_mtx_block))))
  (func $gl_mtx_export_mult_src (export "gl_mtx_mult_src")
    (call $gl_mtx_mult (call $gl_mtx_staging (call $gl_mtx_block))))
  (func $gl_mtx_export_push (export "gl_mtx_push") (call $gl_mtx_push))
  (func $gl_mtx_export_pop (export "gl_mtx_pop") (call $gl_mtx_pop))
  (func $gl_mtx_export_translate (export "gl_mtx_translate")
      (param $x f64) (param $y f64) (param $z f64)
    (call $gl_mtx_translate (local.get $x) (local.get $y) (local.get $z)))
  (func $gl_mtx_export_scale (export "gl_mtx_scale")
      (param $x f64) (param $y f64) (param $z f64)
    (call $gl_mtx_scale (local.get $x) (local.get $y) (local.get $z)))
  (func $gl_mtx_export_rotate (export "gl_mtx_rotate")
      (param $a f64) (param $x f64) (param $y f64) (param $z f64)
    (call $gl_mtx_rotate (local.get $a) (local.get $x) (local.get $y) (local.get $z)))
  (func $gl_mtx_export_frustum (export "gl_mtx_frustum")
      (param $l f64) (param $r f64) (param $b f64)
      (param $t f64) (param $n f64) (param $f f64)
    (call $gl_mtx_frustum (local.get $l) (local.get $r) (local.get $b)
      (local.get $t) (local.get $n) (local.get $f)))
  (func $gl_mtx_export_ortho (export "gl_mtx_ortho")
      (param $l f64) (param $r f64) (param $b f64)
      (param $t f64) (param $n f64) (param $f f64)
    (call $gl_mtx_ortho (local.get $l) (local.get $r) (local.get $b)
      (local.get $t) (local.get $n) (local.get $f)))
