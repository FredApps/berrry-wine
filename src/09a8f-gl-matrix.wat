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
  ;;   +8352 light model ambient, 4 f32
  ;;   +8368 eight lights, 64 bytes each: position, ambient, diffuse, specular
  ;;   +8880 material: ambient, diffuse, specular, emission (16 each),
  ;;         then shininess f32 at +8944, padding to +8960
  ;;   +8960 fog: mode i32, density f32, start f32, end f32, colour 4 f32
  ;;         (ends at +8992)
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

  ;; Store four f32 at a vector slot.
  (func $gl_mtx_set4 (param $p i32)
      (param $x f32) (param $y f32) (param $z f32) (param $w f32)
    (f32.store offset=0 (local.get $p) (local.get $x))
    (f32.store offset=4 (local.get $p) (local.get $y))
    (f32.store offset=8 (local.get $p) (local.get $z))
    (f32.store offset=12 (local.get $p) (local.get $w)))

  ;; GL's lighting, material and fog defaults (lib/gl-compat.js:378-393). They
  ;; are not all zero, so a freshly zeroed block is NOT a legal GL state: an
  ;; app that enables lighting without setting anything must still get light 0
  ;; white and the material's 0.8 grey diffuse, or everything it draws comes
  ;; out black.
  (func $gl_mtx_init_lighting (param $b i32)
    (local $i i32) (local $light i32)
    (call $gl_mtx_set4 (i32.add (local.get $b) (i32.const 8352))
      (f32.const 0.2) (f32.const 0.2) (f32.const 0.2) (f32.const 1))
    (local.set $i (i32.const 0))
    (loop $lights
      (local.set $light (i32.add (local.get $b)
        (i32.add (i32.const 8368) (i32.mul (local.get $i) (i32.const 64)))))
      (call $gl_mtx_set4 (local.get $light)
        (f32.const 0) (f32.const 0) (f32.const 1) (f32.const 0))
      (call $gl_mtx_set4 (i32.add (local.get $light) (i32.const 16))
        (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 1))
      ;; Only light 0 is lit by default; every other light contributes nothing
      ;; until the app gives it a colour.
      (if (i32.eqz (local.get $i))
        (then
          (call $gl_mtx_set4 (i32.add (local.get $light) (i32.const 32))
            (f32.const 1) (f32.const 1) (f32.const 1) (f32.const 1))
          (call $gl_mtx_set4 (i32.add (local.get $light) (i32.const 48))
            (f32.const 1) (f32.const 1) (f32.const 1) (f32.const 1)))
        (else
          (call $gl_mtx_set4 (i32.add (local.get $light) (i32.const 32))
            (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 1))
          (call $gl_mtx_set4 (i32.add (local.get $light) (i32.const 48))
            (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $lights (i32.lt_u (local.get $i) (i32.const 8))))
    (call $gl_mtx_set4 (i32.add (local.get $b) (i32.const 8880))
      (f32.const 0.2) (f32.const 0.2) (f32.const 0.2) (f32.const 1))
    (call $gl_mtx_set4 (i32.add (local.get $b) (i32.const 8896))
      (f32.const 0.8) (f32.const 0.8) (f32.const 0.8) (f32.const 1))
    (call $gl_mtx_set4 (i32.add (local.get $b) (i32.const 8912))
      (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 1))
    (call $gl_mtx_set4 (i32.add (local.get $b) (i32.const 8928))
      (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 1))
    (f32.store offset=8944 (local.get $b) (f32.const 0))
    (i32.store offset=8960 (local.get $b) (i32.const 0x0800))
    (f32.store offset=8964 (local.get $b) (f32.const 1))
    (f32.store offset=8968 (local.get $b) (f32.const 0))
    (f32.store offset=8972 (local.get $b) (f32.const 1))
    (call $gl_mtx_set4 (i32.add (local.get $b) (i32.const 8976))
      (f32.const 0) (f32.const 0) (f32.const 0) (f32.const 0)))

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
    (local.set $guest (call $heap_alloc (i32.const 8992)))
    (if (i32.eqz (local.get $guest)) (then
      (call $heap_free (call $w2g (local.get $p))) (unreachable)))
    (local.set $block (call $g2w (local.get $guest)))
    (memory.fill (local.get $block) (i32.const 0) (i32.const 8992))
    (i32.store (local.get $block) (i32.const 0x1700))
    ;; Every stack starts one deep, holding identity.
    (local.set $s (i32.const 0))
    (loop $init
      (call $gl_mtx_identity_at
        (call $gl_mtx_base (local.get $block) (local.get $s)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $init (i32.lt_u (local.get $s) (i32.const 4))))
    (call $gl_mtx_init_lighting (local.get $block))
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

  ;; Lighting, material and fog. These are pure state: unlike the matrices
  ;; there is no arithmetic to get wrong, with one exception that matters --
  ;; glLightfv(GL_POSITION) transforms its argument by the MODELVIEW matrix at
  ;; the time of the call, and by the modelview specifically, not by whichever
  ;; stack glMatrixMode happens to have selected. lib/gl-compat.js:645 reaches
  ;; past _stack() into matrices[MODELVIEW] for exactly that reason, and a
  ;; mirror that used the selected stack would place every light wrongly in any
  ;; app that sets a light while a texture or projection matrix is current.

  ;; Copy four f32 from $src to $dst.
  (func $gl_mtx_copy4 (param $dst i32) (param $src i32)
    (memory.copy (local.get $dst) (local.get $src) (i32.const 16)))

  (func $gl_mtx_light_slot (param $b i32) (param $index i32) (result i32)
    (i32.add (local.get $b)
      (i32.add (i32.const 8368) (i32.mul (local.get $index) (i32.const 64)))))

  ;; transform4 (lib/gl-compat.js:193-200): a column-major matrix times a
  ;; 4-vector, accumulated in f64 and demoted on store like everything else.
  (func $gl_mtx_transform4 (param $dst i32) (param $m i32) (param $v i32)
    (local $row i32) (local $k i32) (local $acc f64)
    (local.set $row (i32.const 0))
    (loop $rows
      (local.set $acc (f64.const 0))
      (local.set $k (i32.const 0))
      (loop $ks
        (local.set $acc (f64.add (local.get $acc)
          (f64.mul
            (f64.promote_f32 (f32.load (i32.add (local.get $m)
              (i32.mul (i32.const 4)
                (i32.add (i32.mul (local.get $k) (i32.const 4))
                  (local.get $row))))))
            (f64.promote_f32 (f32.load (i32.add (local.get $v)
              (i32.mul (local.get $k) (i32.const 4))))))))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br_if $ks (i32.lt_u (local.get $k) (i32.const 4))))
      (f32.store (i32.add (local.get $dst) (i32.mul (local.get $row) (i32.const 4)))
        (f32.demote_f64 (local.get $acc)))
      (local.set $row (i32.add (local.get $row) (i32.const 1)))
      (br_if $rows (i32.lt_u (local.get $row) (i32.const 4)))))

  ;; glLightfv. $light is the GL enum (GL_LIGHT0 + n); out-of-range lights are
  ;; ignored, as they are in the JS. $values points at four f32.
  (func $gl_mtx_set_light (param $light i32) (param $pname i32) (param $values i32)
    (local $b i32) (local $index i32) (local $slot i32)
    (local.set $b (call $gl_mtx_block))
    (local.set $index (i32.sub (local.get $light) (i32.const 0x4000)))
    (if (i32.ge_u (local.get $index) (i32.const 8)) (then (return)))
    (local.set $slot (call $gl_mtx_light_slot (local.get $b) (local.get $index)))
    ;; GL_POSITION 0x1203, AMBIENT 0x1200, DIFFUSE 0x1201, SPECULAR 0x1202.
    (if (i32.eq (local.get $pname) (i32.const 0x1203))
      (then
        ;; Stack 0 is the modelview, whatever the current matrix mode is.
        (call $gl_mtx_transform4 (local.get $slot)
          (i32.add (call $gl_mtx_base (local.get $b) (i32.const 0))
            (i32.mul (i32.const 64) (i32.load offset=8 (local.get $b))))
          (local.get $values))
        (return)))
    (if (i32.eq (local.get $pname) (i32.const 0x1200))
      (then (call $gl_mtx_copy4 (i32.add (local.get $slot) (i32.const 16))
        (local.get $values)) (return)))
    (if (i32.eq (local.get $pname) (i32.const 0x1201))
      (then (call $gl_mtx_copy4 (i32.add (local.get $slot) (i32.const 32))
        (local.get $values)) (return)))
    (if (i32.eq (local.get $pname) (i32.const 0x1202))
      (then (call $gl_mtx_copy4 (i32.add (local.get $slot) (i32.const 48))
        (local.get $values)))))

  ;; glLightModelfv(GL_LIGHT_MODEL_AMBIENT).
  (func $gl_mtx_set_light_model_ambient (param $values i32)
    (call $gl_mtx_copy4 (i32.add (call $gl_mtx_block) (i32.const 8352))
      (local.get $values)))

  ;; glMaterialfv. GL_AMBIENT_AND_DIFFUSE writes both, which is why these are
  ;; independent tests rather than a chain.
  (func $gl_mtx_set_material (param $pname i32) (param $values i32)
    (local $b i32) (local $v f32)
    (local.set $b (call $gl_mtx_block))
    (if (i32.or (i32.eq (local.get $pname) (i32.const 0x1200))
        (i32.eq (local.get $pname) (i32.const 0x1602)))
      (then (call $gl_mtx_copy4 (i32.add (local.get $b) (i32.const 8880))
        (local.get $values))))
    (if (i32.or (i32.eq (local.get $pname) (i32.const 0x1201))
        (i32.eq (local.get $pname) (i32.const 0x1602)))
      (then (call $gl_mtx_copy4 (i32.add (local.get $b) (i32.const 8896))
        (local.get $values))))
    (if (i32.eq (local.get $pname) (i32.const 0x1202))
      (then (call $gl_mtx_copy4 (i32.add (local.get $b) (i32.const 8912))
        (local.get $values))))
    (if (i32.eq (local.get $pname) (i32.const 0x1600))
      (then (call $gl_mtx_copy4 (i32.add (local.get $b) (i32.const 8928))
        (local.get $values))))
    (if (i32.eq (local.get $pname) (i32.const 0x1601))
      (then
        ;; Clamped to [0, 128], as the JS does. f32.min/f32.max propagate NaN
        ;; rather than returning the other operand, so a NaN shininess stays
        ;; NaN here and in JS alike -- Math.max(0, NaN) is also NaN.
        (local.set $v (f32.load (local.get $values)))
        (f32.store offset=8944 (local.get $b)
          (f32.min (f32.const 128) (f32.max (f32.const 0) (local.get $v)))))))

  ;; glFog*(GL_FOG_MODE, ...), with the mode already decoded to an integer.
  (func $gl_mtx_set_fog_mode (param $mode i32)
    (i32.store offset=8960 (call $gl_mtx_block) (local.get $mode)))

  ;; glFogf / glFogfv, for every parameter but the mode.
  (func $gl_mtx_set_fog (param $pname i32) (param $values i32)
    (local $b i32)
    (local.set $b (call $gl_mtx_block))
    ;; GL_FOG_MODE 0x0B65, DENSITY 0x0B62, START 0x0B63, END 0x0B64, COLOR 0x0B66
    ;; GL_FOG_MODE is NOT handled here. The JS takes values[0]|0, and whether
    ;; the bytes at $values are an int (glFogi) or a float (glFogf) depends on
    ;; which entry point the guest called -- reading them the wrong way gives
    ;; a garbage mode rather than a wrong-looking one. $gl_mtx_set_fog_mode
    ;; takes the already-decoded integer instead, so the ambiguity stays with
    ;; the caller, which is the only place that knows.
    (if (i32.eq (local.get $pname) (i32.const 0x0B65)) (then (unreachable)))
    (if (i32.eq (local.get $pname) (i32.const 0x0B62))
      (then
        (f32.store offset=8964 (local.get $b)
          (f32.max (f32.const 0) (f32.load (local.get $values))))
        (return)))
    (if (i32.eq (local.get $pname) (i32.const 0x0B63))
      (then (f32.store offset=8968 (local.get $b)
        (f32.load (local.get $values))) (return)))
    (if (i32.eq (local.get $pname) (i32.const 0x0B64))
      (then (f32.store offset=8972 (local.get $b)
        (f32.load (local.get $values))) (return)))
    (if (i32.eq (local.get $pname) (i32.const 0x0B66))
      (then (call $gl_mtx_copy4 (i32.add (local.get $b) (i32.const 8976))
        (local.get $values)))))

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

  ;; Lighting, material and fog. The setters take a pointer to four f32, which
  ;; a test fills at gl_mtx_staging_ptr; the getters hand back the address of
  ;; the stored vector so it can be read straight out of linear memory.
  (func $gl_mtx_export_set_light (export "gl_mtx_set_light")
      (param $light i32) (param $pname i32) (param $values i32)
    (call $gl_mtx_set_light (local.get $light) (local.get $pname)
      (local.get $values)))
  (func $gl_mtx_export_light_ptr (export "gl_mtx_light_ptr")
      (param $index i32) (param $field i32) (result i32)
    (i32.add (call $gl_mtx_light_slot (call $gl_mtx_block)
        (i32.and (local.get $index) (i32.const 7)))
      (i32.mul (i32.and (local.get $field) (i32.const 3)) (i32.const 16))))
  (func $gl_mtx_export_set_light_model_ambient
      (export "gl_mtx_set_light_model_ambient") (param $values i32)
    (call $gl_mtx_set_light_model_ambient (local.get $values)))
  (func $gl_mtx_export_light_model_ambient_ptr
      (export "gl_mtx_light_model_ambient_ptr") (result i32)
    (i32.add (call $gl_mtx_block) (i32.const 8352)))
  (func $gl_mtx_export_set_material (export "gl_mtx_set_material")
      (param $pname i32) (param $values i32)
    (call $gl_mtx_set_material (local.get $pname) (local.get $values)))
  (func $gl_mtx_export_material_ptr (export "gl_mtx_material_ptr")
      (param $field i32) (result i32)
    (i32.add (call $gl_mtx_block)
      (i32.add (i32.const 8880)
        (i32.mul (i32.and (local.get $field) (i32.const 3)) (i32.const 16)))))
  (func $gl_mtx_export_shininess (export "gl_mtx_shininess") (result f32)
    (f32.load offset=8944 (call $gl_mtx_block)))
  (func $gl_mtx_export_set_fog (export "gl_mtx_set_fog")
      (param $pname i32) (param $values i32)
    (call $gl_mtx_set_fog (local.get $pname) (local.get $values)))
  (func $gl_mtx_export_set_fog_mode (export "gl_mtx_set_fog_mode") (param $mode i32)
    (call $gl_mtx_set_fog_mode (local.get $mode)))
  (func $gl_mtx_export_fog_mode (export "gl_mtx_fog_mode") (result i32)
    (i32.load offset=8960 (call $gl_mtx_block)))
  (func $gl_mtx_export_fog_density (export "gl_mtx_fog_density") (result f32)
    (f32.load offset=8964 (call $gl_mtx_block)))
  (func $gl_mtx_export_fog_start (export "gl_mtx_fog_start") (result f32)
    (f32.load offset=8968 (call $gl_mtx_block)))
  (func $gl_mtx_export_fog_end (export "gl_mtx_fog_end") (result f32)
    (f32.load offset=8972 (call $gl_mtx_block)))
  (func $gl_mtx_export_fog_color_ptr (export "gl_mtx_fog_color_ptr") (result i32)
    (i32.add (call $gl_mtx_block) (i32.const 8976)))
