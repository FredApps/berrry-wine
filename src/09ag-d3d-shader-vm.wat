;; Dedicated shader VM, program ABI 2 (existing context offsets preserved). All public pointers are WASM offsets, never guest
;; addresses. Owned allocations use the existing heap and must be freed through
;; d3d_shader_vm_free. The owner retains immutable program bytes while contexts
;; execute. No x86 register, threaded IP, dispatch table or code cache is used.
;; Program: magic, ABI, instruction count, bytes; then 64-byte packets.
;; Packet: handler ID (MOV0,ADD1,SUB2,MAD3,MUL4,DP3=5,DP4=6,MIN7,MAX8,
;; matrices9..13,DEF14,NOP15,TEX16,TEXCOORD17,TEXKILL18,TEXREG2AR19), destination slot, mask,
;; arithmetic20..32, TEXBEM33,TEXBEML34,TEXREG2GB35,
;; TEXM3x2PAD36/TEX37, TEXM3x3PAD38/TEX39/SPEC40/VSPEC41.
;; PS1.2 TEXREG2RGB42,TEXDP3TEX43,TEXDP3=44,TEXM3x3=45,CMP46;
;; PS1.3 TEXM3x2DEPTH47 publishes separate depth, not a mutable t register.
;; DP4 reuses handler6. Native IR enforces profile slots and CMP restrictions.
;; flags (bit0 saturation, bit1 a0 floor, bit2 coissued SECOND packet,
;; bit4 private VS2 MOVA nearest-even,
;; bit3 fixed-origin TEXBEML clamps luminance and preserves sampled alpha,
;; signed result shift byte at bit8); three sources
;; (slot, swizzle, modifier, reserved). Static handlers consume f32x4 SoA values.
;; Source modifier bit8 selects bounded per-lane c[a0.x + index] gather.
;; Private bit9 marks VS2 constants (logical slots256..511); c128..255
;; physically append at slots1024..1151, preserving all legacy banks/samplers.
;; DEF14 stores four immediate IEEE words at packet+16 and is hoisted before all
;; executable instructions. Matrix9..13 carry source row0 and fixed shape ID.
;; Context: magic, program, PC, status, output lane mask, retired,
;; +24 helper execution mask (0 inherits output mask), +28 reserved; then
;; 7 banks * 128 registers * 64 bytes (x/y/z/w component vectors).
;; Bump tail: four32-byte copied records at57600 (six f32, valid, reserved).
;; Tail: four 48-byte sampler records at57376, discard mask at57568.
;; Mip tail: four1280-byte records at57728; legacy prefix62848. Stage4/5
;; end65568; private VS2 c128..255 append8192 bytes, total73760. Old offsets unchanged.
;; Mip descriptor64: ABI1,count,levelTable,format,U,V,border,min,mag,mip,
;; f32 bias,absolute MAXMIPLEVEL,firstResidentLevel,originalW,originalH,flags.
;; flags bit0=cube: six face-major level arrays, +X,-X,+Y,-Y,+Z,-Z.
;; Initial cube mode requires CLAMP addressing; face-local bilinear filtering.
;; Level16: pixels,width,height,pitch; copied into mip record+64 (max12 per face).
;; Final-record padding62784/62800 holds hidden M3x3 U/V, outside level metadata.
;; Padding62816 holds PS1.3 depth output (four lanes),62832 its validity flag.
;; Pixel allocations remain caller-retained. Old sampler+36 points to mip record.
;; Explicit sample_lod uses original-resource LOD units, applies bias then
;; clamps to resident/MAXMIPLEVEL range; lod<=0 uses mag, positive uses min.
;; Point mip ties round upward; linear interpolates adjacent levels. Nonfinite
;; LOD/invalid binding returns NaN. Implicit mip TEX requires execution mask15.
;; Texture descriptor (36 bytes copied on bind): WASM pixels,width,height,pitch,
;; format(0 RGBA,21 BGRA,22 BGRX,62 X8L8V8U8), addressU/addressV(1wrap,2mirror,3clamp,4border),
;; filter(1point,2linear), ARGB border. Pixel bytes remain externally retained.
;; TEX/TEXCOORD use immutable interpolated t inputs copied at PC0 to v16..v19.
;; Missing textures return status-3 before retiring the sampling instruction.
;; Initial numeric subset uses ordinary non-fused f32 SIMD. MIN/MAX propagate
;; NaNs and distinguish signed zero as Wasm specifies; native profile conformance
;; remains separately tracked. Unsupported mip/cube/flow
;; operations reject at compile time, never execute as successful no-ops.

(func $d3d_shader_vm_range (param $p i32) (param $n i32) (result i32)
  (i32.and (i32.ge_u (local.get $p) (i32.const 256))
    (i64.le_u (i64.add (i64.extend_i32_u (local.get $p)) (i64.extend_i32_u (local.get $n)))
      (i64.shl (i64.extend_i32_u (memory.size)) (i64.const 16)))))

;; PS1.4 six-stage prerequisite: preserve the entire legacy62848-byte prefix.
;; Stage4/5 each append legacy48 + bump32 + mip1280 bytes. Register storage,
;; original-coordinate snapshots and shader-depth offsets do not move.
(func $d3d_shader_vm_context_bytes (export "d3d_shader_vm_context_bytes") (result i32) (i32.const 73760))
(func $d3d_shader_vm_sampler (param $ctx i32) (param $stage i32) (result i32)
  (i32.add (local.get $ctx) (select
    (i32.add (i32.const 57376) (i32.mul (local.get $stage) (i32.const 48)))
    (i32.add (i32.const 62848) (i32.mul (i32.sub (local.get $stage) (i32.const 4)) (i32.const 1360)))
    (i32.lt_u (local.get $stage) (i32.const 4)))))
(func $d3d_shader_vm_bump (param $ctx i32) (param $stage i32) (result i32)
  (select (i32.add (local.get $ctx) (i32.add (i32.const 57600) (i32.shl (local.get $stage) (i32.const 5))))
    (i32.add (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)) (i32.const 48))
    (i32.lt_u (local.get $stage) (i32.const 4))))
(func $d3d_shader_vm_mip (param $ctx i32) (param $stage i32) (result i32)
  (select (i32.add (local.get $ctx) (i32.add (i32.const 57728) (i32.mul (local.get $stage) (i32.const 1280))))
    (i32.add (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)) (i32.const 80))
    (i32.lt_u (local.get $stage) (i32.const 4))))

(func $d3d_shader_vm_free (export "d3d_shader_vm_free") (param $p i32)
  (if (local.get $p) (then (call $heap_free (call $w2g (local.get $p))))))

(func $d3d_shader_vm_arity (param $op i32) (result i32)
  (if (i32.eq (local.get $op) (i32.const 84)) (then (return (i32.const 2))))
  (if (i32.eq (local.get $op) (i32.const 88)) (then (return (i32.const 4))))
  (if (call $d3d_ir_ps12_texture (local.get $op)) (then (return (i32.const 2))))
  (if (i32.eq (local.get $op) (i32.const 75)) (then (return (i32.const 3))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 18)) (i32.eq (local.get $op) (i32.const 80)))
    (then (return (i32.const 4))))
  (if (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 6)) (i32.le_u (local.get $op) (i32.const 7)))
        (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 14)) (i32.le_u (local.get $op) (i32.const 16)))
          (i32.or (i32.eq (local.get $op) (i32.const 19))
            (i32.and (i32.ge_u (local.get $op) (i32.const 78)) (i32.le_u (local.get $op) (i32.const 79))))))
    (then (return (i32.const 2))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 17))
        (i32.and (i32.ge_u (local.get $op) (i32.const 12)) (i32.le_u (local.get $op) (i32.const 13))))
    (then (return (i32.const 3))))
  (if (i32.and (i32.ge_u (local.get $op) (i32.const 64)) (i32.le_u (local.get $op) (i32.const 66)))
    (then (return (i32.const 1))))
  (if (i32.and (i32.ge_u (local.get $op) (i32.const 67)) (i32.le_u (local.get $op) (i32.const 76))) (then (return (i32.const 2))))
  (if (i32.eqz (local.get $op)) (then (return (i32.const 0))))
  (if (i32.eq (local.get $op) (i32.const 81)) (then (return (i32.const 5))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 1)) (i32.eq (local.get $op) (i32.const 31)))
    (then (return (i32.const 2))))
  (if (i32.eq (local.get $op) (i32.const 4)) (then (return (i32.const 4))))
  (if (i32.or
    (i32.and (i32.ge_u (local.get $op) (i32.const 2)) (i32.le_u (local.get $op) (i32.const 3)))
    (i32.or (i32.eq (local.get $op) (i32.const 5))
      (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 8)) (i32.le_u (local.get $op) (i32.const 11)))
        (i32.and (i32.ge_u (local.get $op) (i32.const 20)) (i32.le_u (local.get $op) (i32.const 24))))))
    (then (return (i32.const 3))))
  (i32.const -1))

;; Coissue is an atomic scheduling unit of two packets, not sequential ALU
;; evaluation. Both packets read the pre-pair register state. Budget <2 yields
;; before either packet; PC can never resume at the second packet.
(func $d3d_shader_vm_pair_op (param $op i32) (result i32)
  (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 1)) (i32.le_u (local.get $op) (i32.const 5)))
    (i32.or (i32.eq (local.get $op) (i32.const 8))
      (i32.or (i32.eq (local.get $op) (i32.const 18))
        (i32.or (i32.eq (local.get $op) (i32.const 80)) (i32.eq (local.get $op) (i32.const 88)))))))
(func $d3d_shader_vm_pair_destination (param $ins i32) (result i32)
  (i32.or
    (i32.and (i32.eqz (i32.load offset=16 (local.get $ins))) (i32.lt_u (i32.load offset=20 (local.get $ins)) (i32.const 2)))
    (i32.and (i32.eq (i32.load offset=16 (local.get $ins)) (i32.const 3)) (i32.lt_u (i32.load offset=20 (local.get $ins)) (i32.const 4)))))

;; Immutable-program query: oPts scalar output is flat514, x at ctx+32928.
;; Absence is distinct from a shader deliberately writing size zero.
(func $d3d_shader_vm_has_point_size (export "d3d_shader_vm_has_point_size") (param $program i32) (result i32)
  (local $n i32) (local $i i32) (local $pkt i32)
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $program) (i32.const 16))) (then (return (i32.const 0))))
  (if (i32.or (i32.ne (i32.load (local.get $program)) (i32.const 0x4453564d))
    (i32.ne (i32.load offset=4 (local.get $program)) (i32.const 2))) (then (return (i32.const 0))))
  (local.set $n (i32.load offset=8 (local.get $program)))
  (if (i32.gt_u (local.get $n) (i32.const 1024)) (then (return (i32.const 0))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $program) (i32.add (i32.const 16) (i32.shl (local.get $n) (i32.const 6))))) (then (return (i32.const 0))))
  (block $done (loop $packets
    (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
    (local.set $pkt (i32.add (i32.add (local.get $program) (i32.const 16)) (i32.shl (local.get $i) (i32.const 6))))
    (if (i32.and (i32.eq (i32.load offset=4 (local.get $pkt)) (i32.const 514)) (i32.and (i32.load offset=8 (local.get $pkt)) (i32.const 1)))
      (then (return (i32.const 1))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $packets)))
  (i32.const 0))

(func $d3d_shader_vm_arity14 (param $op i32) (result i32)
  (if (i32.eq (local.get $op) (i32.const 65533)) (then (return (i32.const 0))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 64)) (i32.eq (local.get $op) (i32.const 66))) (then (return (i32.const 2))))
  (if (i32.eq (local.get $op) (i32.const 87)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $op) (i32.const 89)) (then (return (i32.const 3))))
  (call $d3d_shader_vm_arity (local.get $op)))

;; This validates the normalized packet boundary, not guest dataflow/phase
;; legality (owned by the native IR compiler). Synthetic IR tests exercise the
;; executor independently without weakening guest bytecode validation.
(func $d3d_shader_vm_validate14 (param $ins i32) (result i32)
  (local $op i32) (local $arity i32) (local $j i32) (local $p i32) (local $bank i32) (local $index i32) (local $mod i32)
  (local.set $op (i32.load (local.get $ins)))
  (if (i32.eqz (i32.or (i32.le_u (local.get $op) (i32.const 5))
    (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 8)) (i32.le_u (local.get $op) (i32.const 11)))
    (i32.or (i32.eq (local.get $op) (i32.const 18))
    (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 64)) (i32.le_u (local.get $op) (i32.const 66)))
    (i32.or (i32.eq (local.get $op) (i32.const 80)) (i32.or (i32.eq (local.get $op) (i32.const 81))
    (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 87)) (i32.le_u (local.get $op) (i32.const 89)))
      (i32.eq (local.get $op) (i32.const 65533)))))))))) (then (return (i32.const 0))))
  (local.set $arity (call $d3d_shader_vm_arity14 (local.get $op)))
  (if (i32.or (i32.ne (i32.load offset=8 (local.get $ins)) (local.get $arity)) (i32.load offset=12 (local.get $ins))) (then (return (i32.const 0))))
  (block $done (loop $args
    (br_if $done (i32.ge_u (local.get $j) (local.get $arity)))
    (local.set $p (i32.add (local.get $ins) (i32.add (i32.const 16) (i32.shl (local.get $j) (i32.const 4)))))
    (local.set $bank (i32.load (local.get $p))) (local.set $index (i32.load offset=4 (local.get $p)))
    (local.set $mod (i32.load offset=12 (local.get $p)))
    (block $arg_done
      (if (i32.eq (local.get $op) (i32.const 81)) (then
        (if (i32.eqz (local.get $j)) (then
          (if (i32.or (i32.ne (local.get $bank) (i32.const 2)) (i32.ge_u (local.get $index) (i32.const 8))) (then (return (i32.const 0)))))
          (else (if (i32.or (i32.ne (local.get $bank) (i32.const 255))
            (i32.eq (i32.and (local.get $index) (i32.const 0x7f800000)) (i32.const 0x7f800000))) (then (return (i32.const 0))))))
        (br $arg_done)))
      (if (i32.or (i32.gt_u (local.get $bank) (i32.const 3))
        (i32.ge_u (local.get $index) (select (i32.const 8) (select (i32.const 2) (i32.const 6) (i32.eq (local.get $bank) (i32.const 1))) (i32.eq (local.get $bank) (i32.const 2))))) (then (return (i32.const 0))))
      (if (i32.eqz (local.get $j)) (then
        (if (i32.and (i32.ne (local.get $bank) (i32.const 0))
          (i32.eqz (i32.and (i32.eq (local.get $op) (i32.const 65)) (i32.eq (local.get $bank) (i32.const 3))))) (then (return (i32.const 0))))
        (if (i32.or (i32.eqz (i32.load offset=8 (local.get $p))) (i32.gt_u (i32.load offset=8 (local.get $p)) (i32.const 15))) (then (return (i32.const 0))))
        (if (i32.ne (i32.and (local.get $mod) (i32.const 0xffff00fe)) (i32.const 0)) (then (return (i32.const 0))))
        (local.set $mod (i32.shr_s (i32.shl (local.get $mod) (i32.const 16)) (i32.const 24)))
        (if (i32.or (i32.lt_s (local.get $mod) (i32.const -3)) (i32.gt_s (local.get $mod) (i32.const 3))) (then (return (i32.const 0)))))
      (else
        (if (i32.gt_u (i32.load offset=8 (local.get $p)) (i32.const 255)) (then (return (i32.const 0))))
        (if (i32.or (i32.eq (local.get $op) (i32.const 64)) (i32.eq (local.get $op) (i32.const 66))) (then
          (if (i32.or (i32.and (i32.ne (local.get $bank) (i32.const 3)) (i32.ne (local.get $bank) (i32.const 0)))
            (i32.and (i32.eq (local.get $op) (i32.const 64)) (i32.ne (local.get $bank) (i32.const 3)))) (then (return (i32.const 0))))
          (if (i32.and (i32.ne (local.get $mod) (i32.const 0)) (i32.ne (local.get $mod) (select (i32.const 10) (i32.const 9) (i32.eq (local.get $bank) (i32.const 3))))) (then (return (i32.const 0))))
          (if (i32.and (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 228)) (i32.ne (i32.load offset=8 (local.get $p)) (i32.const 244))) (then (return (i32.const 0)))))
          (else (if (i32.gt_u (local.get $mod) (i32.const 8)) (then (return (i32.const 0)))))))))
    (local.set $j (i32.add (local.get $j) (i32.const 1))) (br $args)))
  (if (i32.and (i32.eq (local.get $op) (i32.const 87)) (i32.ne (i32.load offset=20 (local.get $ins)) (i32.const 5))) (then (return (i32.const 0))))
  (i32.const 1))

;; Bounded private VS2 normalized-IR contract. Guest declaration/dataflow checks
;; remain decoder-owned. This boundary rejects malformed operands before packet
;; lowering can alias constants with a0, outputs, or sampler metadata.
(func $d3d_shader_vm_validate20 (param $ins i32) (result i32)
  (local $op i32) (local $arity i32) (local $j i32) (local $p i32)
  (local $bank i32) (local $index i32) (local $selector i32) (local $mod i32)
  (local.set $op (i32.load (local.get $ins)))
  (if (i32.eqz (i32.or (i32.le_u (local.get $op) (i32.const 13))
    (i32.or (i32.eq (local.get $op) (i32.const 19))
    (i32.or (i32.eq (local.get $op) (i32.const 31))
    (i32.or (i32.eq (local.get $op) (i32.const 35))
    (i32.or (i32.eq (local.get $op) (i32.const 46)) (i32.eq (local.get $op) (i32.const 81)))))))) (then (return (i32.const 0))))
  (local.set $arity (call $d3d_shader_vm_arity (local.get $op)))
  (if (i32.or (i32.eq (local.get $op) (i32.const 35)) (i32.eq (local.get $op) (i32.const 46)))
    (then (local.set $arity (i32.const 2))))
  (if (i32.or (i32.ne (i32.load offset=8 (local.get $ins)) (local.get $arity))
    (i32.load offset=12 (local.get $ins))) (then (return (i32.const 0))))
  (block $done (loop $operands
    (br_if $done (i32.ge_u (local.get $j) (local.get $arity)))
    (local.set $p (i32.add (local.get $ins) (i32.add (i32.const 16) (i32.shl (local.get $j) (i32.const 4)))))
    (local.set $bank (i32.load (local.get $p))) (local.set $index (i32.load offset=4 (local.get $p)))
    (local.set $selector (i32.load offset=8 (local.get $p))) (local.set $mod (i32.load offset=12 (local.get $p)))
    (block $valid
      (if (i32.eq (local.get $op) (i32.const 81)) (then
        (if (i32.eqz (local.get $j))
          (then (if (i32.or (i32.ne (local.get $bank) (i32.const 2))
            (i32.or (i32.ge_u (local.get $index) (i32.const 256))
            (i32.or (i32.ne (local.get $selector) (i32.const 15)) (local.get $mod)))) (then (return (i32.const 0)))))
          (else (if (i32.or (i32.ne (local.get $bank) (i32.const 255))
            (i32.eq (i32.and (local.get $index) (i32.const 0x7f800000)) (i32.const 0x7f800000))) (then (return (i32.const 0))))))
        (br $valid)))
      (if (i32.eq (local.get $op) (i32.const 31)) (then
        (if (i32.eqz (local.get $j))
          (then (if (i32.ne (local.get $bank) (i32.const 254)) (then (return (i32.const 0)))))
          (else (if (i32.or (i32.ne (local.get $bank) (i32.const 1))
            (i32.or (i32.ge_u (local.get $index) (i32.const 16))
            (i32.or (i32.eqz (local.get $selector)) (i32.or (i32.gt_u (local.get $selector) (i32.const 15)) (local.get $mod)))))
            (then (return (i32.const 0))))))
        (br $valid)))
      (if (i32.eqz (local.get $j)) (then
        (if (i32.or (i32.eqz (local.get $selector)) (i32.or (i32.gt_u (local.get $selector) (i32.const 15)) (i32.gt_u (local.get $mod) (i32.const 1))))
          (then (return (i32.const 0))))
        (if (i32.and (i32.eq (local.get $bank) (i32.const 4)) (i32.ne (local.get $index) (i32.const 0))) (then
          (if (i32.ne (local.get $selector) (i32.const 1)) (then (return (i32.const 0))))))
        (if (i32.eq (local.get $op) (i32.const 46))
          (then (if (i32.or (i32.ne (local.get $bank) (i32.const 3))
            (i32.or (local.get $index) (i32.or (local.get $mod) (i32.ne (local.get $selector) (i32.const 1))))) (then (return (i32.const 0)))))
          (else (if (i32.eqz (i32.or
            (i32.and (i32.eqz (local.get $bank)) (i32.lt_u (local.get $index) (i32.const 12)))
            (i32.or (i32.and (i32.eq (local.get $bank) (i32.const 4)) (i32.lt_u (local.get $index) (i32.const 3)))
            (i32.or (i32.and (i32.eq (local.get $bank) (i32.const 5)) (i32.lt_u (local.get $index) (i32.const 2)))
              (i32.and (i32.eq (local.get $bank) (i32.const 6)) (i32.lt_u (local.get $index) (i32.const 8))))))) (then (return (i32.const 0))))))
      ) (else
        (if (i32.eqz (i32.or
          (i32.and (i32.eqz (local.get $bank)) (i32.lt_u (local.get $index) (i32.const 12)))
          (i32.or (i32.and (i32.eq (local.get $bank) (i32.const 1)) (i32.lt_u (local.get $index) (i32.const 16)))
            (i32.and (i32.eq (local.get $bank) (i32.const 2)) (i32.lt_u (local.get $index) (i32.const 256)))))) (then (return (i32.const 0))))
        (if (i32.or (i32.gt_u (local.get $selector) (i32.const 255))
          (i32.gt_u (i32.and (local.get $mod) (i32.const -257)) (i32.const 1))) (then (return (i32.const 0))))
        (if (i32.and (i32.ne (i32.and (local.get $mod) (i32.const 256)) (i32.const 0)) (i32.ne (local.get $bank) (i32.const 2))) (then (return (i32.const 0))))))
    )
    (local.set $j (i32.add (local.get $j) (i32.const 1))) (br $operands)))
  (i32.const 1))

(func $d3d_shader_vm_compile (export "d3d_shader_vm_compile") (param $ir i32) (result i32)
  (call $d3d_shader_vm_compile_profile (local.get $ir) (i32.const 0)))

;; Development-only foundation, not public shader-profile admission.
(func $d3d_shader_vm_compile_vs20 (export "d3d_shader_vm_compile_vs20") (param $ir i32) (result i32)
  (call $d3d_shader_vm_compile_profile (local.get $ir) (i32.const 1)))

(func $d3d_shader_vm_compile_profile (param $ir i32) (param $vs20 i32) (result i32)
  (local $n i32) (local $i i32) (local $j i32) (local $ins i32)
  (local $arity i32) (local $operand i32) (local $out i32) (local $pkt i32)
  (local $op i32) (local $mod i32) (local $shift i32) (local $previous i32) (local $haspair i32) (local $pad i32) (local $pass i32) (local $emitted i32)
  (local $padnext i32) (local $ps14 i32)
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $ir) (i32.const 32))) (then (return (i32.const 0))))
  (if (i32.or (i32.ne (i32.load (local.get $ir)) (i32.const 0x44534952))
    (i32.ne (i32.load offset=4 (local.get $ir)) (i32.const 1))) (then (return (i32.const 0))))
  (if (local.get $vs20)
    (then (if (i32.or (i32.load offset=8 (local.get $ir))
      (i32.ne (i32.load offset=12 (local.get $ir)) (i32.const 0xfffe0200))) (then (return (i32.const 0)))))
    (else (if (i32.eq (i32.load offset=12 (local.get $ir)) (i32.const 0xfffe0200)) (then (return (i32.const 0))))))
  (local.set $n (i32.load offset=16 (local.get $ir)))
  (if (i32.and (local.get $vs20) (i32.ne (i32.and (i32.load offset=28 (local.get $ir)) (i32.const -2)) (i32.const 0)))
    (then (return (i32.const 0))))
  (local.set $ps14 (i32.and (i32.eq (i32.load offset=8 (local.get $ir)) (i32.const 1)) (i32.eq (i32.load offset=12 (local.get $ir)) (i32.const 0xffff0104))))
  ;; Flag0 relative constants, flag2 emulator-generated fixed-function IR.
  ;; Flag1 coissue metadata is preserved into programABI2 packet flags.
  (if (i32.or (i32.gt_u (local.get $n) (i32.const 1024))
    (i32.ne (i32.and (i32.load offset=28 (local.get $ir)) (i32.const -8)) (i32.const 0))) (then (return (i32.const 0))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $ir)
    (i32.add (i32.const 32) (i32.shl (local.get $n) (i32.const 7))))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load offset=24 (local.get $ir))
    (i32.add (i32.const 32) (i32.shl (local.get $n) (i32.const 7)))) (then (return (i32.const 0))))
  ;; Validate all packets before allocating or publishing anything.
  (block $validated (loop $validate
    (br_if $validated (i32.ge_u (local.get $i) (local.get $n)))
    (local.set $ins (i32.add (i32.add (local.get $ir) (i32.const 32)) (i32.shl (local.get $i) (i32.const 7))))
    (local.set $op (i32.load (local.get $ins)))
    (block $instruction_validated
    (if (local.get $vs20) (then
      (if (i32.eqz (call $d3d_shader_vm_validate20 (local.get $ins))) (then (return (i32.const 0))))
      (br $instruction_validated)))
    (if (local.get $ps14) (then
      (if (i32.eqz (call $d3d_shader_vm_validate14 (local.get $ins))) (then (return (i32.const 0))))
      (br $instruction_validated)))
    (if (i32.and (call $d3d_ir_ps12_op (local.get $op)) (i32.ne (local.get $op) (i32.const 9))) (then
      (if (i32.or (i32.ne (i32.load offset=8 (local.get $ir)) (i32.const 1))
        (i32.and (i32.ne (i32.load offset=12 (local.get $ir)) (i32.const 0xffff0102))
          (i32.ne (i32.load offset=12 (local.get $ir)) (i32.const 0xffff0103)))) (then (return (i32.const 0))))))
    (if (i32.and (i32.eq (local.get $op) (i32.const 9)) (i32.eq (i32.load offset=8 (local.get $ir)) (i32.const 1))) (then
      (if (i32.and (i32.ne (i32.load offset=12 (local.get $ir)) (i32.const 0xffff0102))
        (i32.ne (i32.load offset=12 (local.get $ir)) (i32.const 0xffff0103))) (then (return (i32.const 0))))))
    (if (i32.eq (local.get $op) (i32.const 84)) (then
      (if (i32.or (i32.ne (i32.load offset=8 (local.get $ir)) (i32.const 1))
        (i32.ne (i32.load offset=12 (local.get $ir)) (i32.const 0xffff0103))) (then (return (i32.const 0))))))
    (local.set $arity (call $d3d_shader_vm_arity (local.get $op)))
    (if (i32.load offset=12 (local.get $ins)) (then
      (if (i32.or (i32.eqz (local.get $i)) (i32.ne (i32.load offset=8 (local.get $ir)) (i32.const 1)))
        (then (return (i32.const 0))))
      (local.set $previous (i32.sub (local.get $ins) (i32.const 128)))
      (if (i32.eqz (i32.and (call $d3d_shader_vm_pair_destination (local.get $ins))
            (call $d3d_shader_vm_pair_destination (local.get $previous)))) (then (return (i32.const 0))))
      (if (i32.or (i32.load offset=12 (local.get $previous))
            (i32.eqz (i32.and (call $d3d_shader_vm_pair_op (local.get $op)) (call $d3d_shader_vm_pair_op (i32.load (local.get $previous))))))
        (then (return (i32.const 0))))
      (if (i32.or (i32.ne (i32.xor (i32.load offset=24 (local.get $ins)) (i32.load offset=24 (local.get $previous))) (i32.const 15))
            (i32.eqz (i32.or (i32.eq (i32.load offset=24 (local.get $ins)) (i32.const 7))
              (i32.eq (i32.load offset=24 (local.get $ins)) (i32.const 8))))) (then (return (i32.const 0))))
      (local.set $haspair (i32.const 2))))

    (if (i32.or (i32.eq (local.get $op) (i32.const 84)) (i32.or (call $d3d_ir_ps12_texture (local.get $op)) (i32.and (i32.ge_u (local.get $op) (i32.const 71)) (i32.le_u (local.get $op) (i32.const 76))))) (then
      (if (i32.or (i32.ne (i32.load offset=32 (local.get $ins)) (i32.const 3))
            (i32.or (i32.ge_u (i32.load offset=36 (local.get $ins)) (i32.load offset=20 (local.get $ins)))
              (i32.or (i32.ne (i32.load offset=40 (local.get $ins)) (i32.const 228))
                (i32.or (i32.ne (i32.load offset=24 (local.get $ins)) (i32.const 15))
                  (i32.ne (i32.load offset=28 (local.get $ins)) (i32.const 0)))))) (then (return (i32.const 0))))
      (if (i32.and (i32.ne (i32.load offset=44 (local.get $ins)) (i32.const 0))
            (i32.ne (i32.load offset=44 (local.get $ins)) (i32.const 4))) (then (return (i32.const 0))))))
    (if (i32.and (i32.ne (local.get $pad) (i32.const 0)) (i32.ne
      (select (i32.const 72) (select (i32.const 74) (local.get $op) (i32.or (i32.eq (local.get $op) (i32.const 86)) (i32.and (i32.ge_u (local.get $op) (i32.const 75)) (i32.le_u (local.get $op) (i32.const 76))))) (i32.eq (local.get $op) (i32.const 84)))
      (local.get $padnext))) (then (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 75)) (then
      (if (i32.or (i32.ne (i32.load offset=48 (local.get $ins)) (i32.const 2))
        (i32.or (i32.ge_u (i32.load offset=52 (local.get $ins)) (i32.const 8))
          (i32.or (i32.ne (i32.load offset=56 (local.get $ins)) (i32.const 228)) (i32.load offset=60 (local.get $ins)))))
        (then (return (i32.const 0))))))
    (if (i32.or (i32.eq (local.get $op) (i32.const 84)) (i32.or (i32.eq (local.get $op) (i32.const 86)) (i32.and (i32.ge_u (local.get $op) (i32.const 71)) (i32.le_u (local.get $op) (i32.const 76))))) (then
    (if (i32.and (i32.eqz (local.get $pad)) (i32.or (i32.eq (local.get $op) (i32.const 71)) (i32.eq (local.get $op) (i32.const 73)))) (then
      (local.set $pad (local.get $ins))
      (local.set $padnext (select (i32.const 73) (i32.const 72) (i32.eq (local.get $op) (i32.const 73))))
      (if (i32.or (i32.eqz (i32.load offset=20 (local.get $ins))) (i32.ge_u (i32.load offset=20 (local.get $ins))
        (select (i32.const 2) (i32.const 3) (i32.eq (local.get $op) (i32.const 73)))))
        (then (return (i32.const 0))))) (else
      (if (i32.eqz (local.get $pad)) (then (return (i32.const 0))))
      (if (i32.or (i32.ne (i32.load offset=20 (local.get $ins)) (i32.add (i32.load offset=20 (local.get $pad)) (i32.const 1)))
            (i32.or (i64.ne (i64.load offset=32 (local.get $ins)) (i64.load offset=32 (local.get $pad)))
              (i64.ne (i64.load offset=40 (local.get $ins)) (i64.load offset=40 (local.get $pad))))) (then (return (i32.const 0))))
      (if (i32.eq (local.get $op) (i32.const 73)) (then
        (local.set $pad (local.get $ins)) (local.set $padnext (i32.const 74)))
      (else (local.set $pad (i32.const 0))))))))
    (if (i32.or (i32.eq (local.get $op) (i32.const 84)) (i32.or (call $d3d_ir_ps12_texture (local.get $op)) (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 64)) (i32.le_u (local.get $op) (i32.const 66)))
          (i32.and (i32.ge_u (local.get $op) (i32.const 67)) (i32.le_u (local.get $op) (i32.const 76)))))) (then
      (if (i32.or (i32.ne (i32.load offset=8 (local.get $ir)) (i32.const 1))
            (i32.or (i32.ne (i32.load offset=16 (local.get $ins)) (i32.const 3))
              (i32.ge_u (i32.load offset=20 (local.get $ins))
                (select (i32.const 6) (i32.const 4)
                  (i32.and (i32.and (i32.ge_u (local.get $op) (i32.const 66)) (i32.le_u (local.get $op) (i32.const 68)))
                    (i32.ne (i32.and (i32.load offset=28 (local.get $ir)) (i32.const 4)) (i32.const 0)))))))
        (then (return (i32.const 0))))))
    (if (i32.or (i32.lt_s (local.get $arity) (i32.const 0))
      (i32.or (i32.ne (i32.load offset=8 (local.get $ins)) (local.get $arity))
        (i32.gt_u (i32.load offset=12 (local.get $ins)) (i32.const 1)))) (then (return (i32.const 0))))
    (local.set $j (i32.const 0))
    (block $operands_done (loop $operands
      (br_if $operands_done (i32.ge_u (local.get $j) (local.get $arity)))
      (local.set $operand (i32.add (i32.add (local.get $ins) (i32.const 16)) (i32.shl (local.get $j) (i32.const 4))))
      (if (i32.and (i32.eq (i32.load offset=8 (local.get $ir)) (i32.const 1)) (i32.eq (local.get $op) (i32.const 9))) (then
        (if (i32.ne (i32.load offset=16 (local.get $ins)) (i32.const 0)) (then (return (i32.const 0))))))
      (if (i32.and (i32.or (i32.eq (local.get $op) (i32.const 88))
          (i32.and (i32.eq (i32.load offset=8 (local.get $ir)) (i32.const 1)) (i32.eq (local.get $op) (i32.const 9)))) (i32.ne (local.get $j) (i32.const 0))) (then
        (if (i64.eq (i64.load (local.get $operand)) (i64.load offset=16 (local.get $ins))) (then (return (i32.const 0))))))
      (block $operand_validated
      (if (i32.eq (local.get $op) (i32.const 81)) (then
        (if (i32.eqz (local.get $j)) (then
          (if (i32.or (i32.ne (i32.load (local.get $operand)) (i32.const 2))
                (i32.ge_u (i32.load offset=4 (local.get $operand))
                  (select (i32.const 96) (i32.const 8) (i32.eqz (i32.load offset=8 (local.get $ir))))))
            (then (return (i32.const 0)))))
        (else
          (if (i32.or (i32.ne (i32.load (local.get $operand)) (i32.const 255))
                (i32.eq (i32.and (i32.load offset=4 (local.get $operand)) (i32.const 0x7f800000)) (i32.const 0x7f800000)))
            (then (return (i32.const 0))))))
        (br $operand_validated)))
      (if (i32.eq (local.get $op) (i32.const 31)) (then
        (if (i32.ne (i32.load offset=8 (local.get $ir)) (i32.const 0)) (then (return (i32.const 0))))
        (if (i32.eqz (local.get $j)) (then
          (if (i32.ne (i32.load (local.get $operand)) (i32.const 254)) (then (return (i32.const 0)))))
        (else (if (i32.or (i32.ne (i32.load (local.get $operand)) (i32.const 1))
                    (i32.ge_u (i32.load offset=4 (local.get $operand)) (i32.const 16)))
          (then (return (i32.const 0))))))
        (br $operand_validated)))
      (if (i32.or (i32.gt_u (i32.load (local.get $operand)) (i32.const 6))
        (i32.gt_u (i32.load offset=4 (local.get $operand)) (i32.const 127))) (then (return (i32.const 0))))
      (if (i32.and (i32.eq (i32.load (local.get $operand)) (i32.const 4)) (i32.or (i32.eq (i32.load offset=4 (local.get $operand)) (i32.const 1)) (i32.eq (i32.load offset=4 (local.get $operand)) (i32.const 2)))) (then
        (if (i32.and (i32.ge_u (local.get $op) (i32.const 20)) (i32.le_u (local.get $op) (i32.const 24))) (then (return (i32.const 0))))
        (if (i32.or (local.get $j) (i32.or (i32.load offset=8 (local.get $ir))
          (i32.or (i32.gt_u (i32.load offset=12 (local.get $operand)) (select (i32.const 1) (i32.const 0) (i32.eq (i32.load offset=4 (local.get $operand)) (i32.const 1))))
            (i32.eqz (i32.or (i32.eq (i32.load offset=8 (local.get $operand)) (i32.const 1)) (i32.eq (i32.load offset=8 (local.get $operand)) (i32.const 15)))))))
          (then (return (i32.const 0))))))
      (if (i32.eqz (local.get $j))
        (then
          (if (i32.or (i32.eqz (i32.load offset=8 (local.get $operand)))
            (i32.or (i32.gt_u (i32.load offset=8 (local.get $operand)) (i32.const 15))
              (i32.ne (i32.and (i32.load offset=12 (local.get $operand)) (i32.const 0xffff00fe)) (i32.const 0)))) (then (return (i32.const 0))))
          (local.set $shift (i32.shr_s (i32.shl (i32.load offset=12 (local.get $operand)) (i32.const 16)) (i32.const 24)))
          (if (i32.or (i32.lt_s (local.get $shift) (i32.const -3)) (i32.gt_s (local.get $shift) (i32.const 3)))
            (then (return (i32.const 0)))))
        (else
          (local.set $mod (i32.load offset=12 (local.get $operand)))
          (if (i32.or (i32.gt_u (i32.load offset=8 (local.get $operand)) (i32.const 255))
            (i32.gt_u (i32.and (local.get $mod) (i32.const 0xfffffeff)) (i32.const 8))) (then (return (i32.const 0))))
          (if (i32.and (local.get $mod) (i32.const 256)) (then
            (if (i32.or (i32.ne (i32.load offset=8 (local.get $ir)) (i32.const 0))
                  (i32.or (i32.ne (i32.load (local.get $operand)) (i32.const 2))
                    (i32.ge_u (i32.load offset=4 (local.get $operand)) (i32.const 96))))
              (then (return (i32.const 0))))))
          (if (i32.and (i32.eq (local.get $j) (i32.const 2))
                (i32.and (i32.ge_u (local.get $op) (i32.const 20)) (i32.le_u (local.get $op) (i32.const 24))))
            (then (if (i32.gt_u (i32.load offset=4 (local.get $operand)) (i32.const 124))
              (then (return (i32.const 0)))))))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $operands))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $validate)))
  (if (local.get $pad) (then (return (i32.const 0))))
  (if (i32.ne (local.get $haspair) (i32.and (i32.load offset=28 (local.get $ir)) (i32.const 2))) (then (return (i32.const 0))))
  (local.set $out (call $heap_alloc (i32.add (i32.const 16) (i32.shl (local.get $n) (i32.const 6)))))
  (if (i32.eqz (local.get $out)) (then (return (i32.const 0))))
  (local.set $out (call $g2w (local.get $out)))
  (memory.fill (local.get $out) (i32.const 0) (i32.add (i32.const 16) (i32.shl (local.get $n) (i32.const 6))))
  (i32.store (local.get $out) (i32.const 0x4453564d))
  (i32.store offset=4 (local.get $out) (i32.const 2))
  (i32.store offset=8 (local.get $out) (local.get $n))
  (i32.store offset=12 (local.get $out) (i32.add (i32.const 16) (i32.shl (local.get $n) (i32.const 6))))
  (local.set $i (i32.const 0))
  ;; DEF has shader-local lifetime independent of its original instruction
  ;; position. Hoist definitions into the immutable prologue; each context runs
  ;; that prologue after the frontend has supplied its application constants.
  (loop $passes
  (block $emitted_pass (loop $emit
    (br_if $emitted_pass (i32.ge_u (local.get $i) (local.get $n)))
    (local.set $ins (i32.add (i32.add (local.get $ir) (i32.const 32)) (i32.shl (local.get $i) (i32.const 7))))
    (local.set $op (i32.load (local.get $ins)))
    (block $skip_emit
    (br_if $skip_emit (i32.ne (i32.eq (local.get $op) (i32.const 81)) (i32.eqz (local.get $pass))))
    (local.set $pkt (i32.add (i32.add (local.get $out) (i32.const 16)) (i32.shl (local.get $emitted) (i32.const 6))))
    (local.set $emitted (i32.add (local.get $emitted) (i32.const 1)))
    (if (i32.eq (local.get $op) (i32.const 65533)) (then
      (i32.store (local.get $pkt) (i32.const 48)) (br $skip_emit)))
    (if (i32.or (i32.eqz (local.get $op)) (i32.eq (local.get $op) (i32.const 31))) (then
      (i32.store (local.get $pkt) (i32.const 15)) (br $skip_emit)))
    (i32.store (local.get $pkt) (i32.sub (i32.load (local.get $ins))
      (select (i32.const 1) (i32.const 3) (i32.le_u (i32.load (local.get $ins)) (i32.const 5)))))
    (if (i32.and (i32.ge_u (local.get $op) (i32.const 20)) (i32.le_u (local.get $op) (i32.const 24)))
      (then (i32.store (local.get $pkt) (i32.sub (local.get $op) (i32.const 11)))))
    (if (i32.eq (local.get $op) (i32.const 66)) (then (i32.store (local.get $pkt) (i32.const 16))))
    (if (i32.eq (local.get $op) (i32.const 64)) (then (i32.store (local.get $pkt) (i32.const 17))))
    (if (i32.eq (local.get $op) (i32.const 65)) (then (i32.store (local.get $pkt) (i32.const 18))))
    (if (i32.eq (local.get $op) (i32.const 69)) (then (i32.store (local.get $pkt) (i32.const 19))))
    (if (i32.eq (local.get $op) (i32.const 67)) (then (i32.store (local.get $pkt) (i32.const 33))))
    (if (i32.eq (local.get $op) (i32.const 68)) (then (i32.store (local.get $pkt) (i32.const 34))))
    (if (i32.eq (local.get $op) (i32.const 70)) (then (i32.store (local.get $pkt) (i32.const 35))))
    (if (i32.eq (local.get $op) (i32.const 71)) (then (i32.store (local.get $pkt) (i32.const 36))))
    (if (i32.eq (local.get $op) (i32.const 72)) (then (i32.store (local.get $pkt) (i32.const 37))))
    (if (i32.eq (local.get $op) (i32.const 73)) (then (i32.store (local.get $pkt) (i32.const 38))))
    (if (i32.eq (local.get $op) (i32.const 74)) (then (i32.store (local.get $pkt) (i32.const 39))))
    (if (i32.eq (local.get $op) (i32.const 75)) (then (i32.store (local.get $pkt) (i32.const 40))))
    (if (i32.eq (local.get $op) (i32.const 76)) (then (i32.store (local.get $pkt) (i32.const 41))))
    (if (i32.eq (local.get $op) (i32.const 82)) (then (i32.store (local.get $pkt) (i32.const 42))))
    (if (i32.eq (local.get $op) (i32.const 83)) (then (i32.store (local.get $pkt) (i32.const 43))))
    (if (i32.eq (local.get $op) (i32.const 85)) (then (i32.store (local.get $pkt) (i32.const 44))))
    (if (i32.eq (local.get $op) (i32.const 86)) (then (i32.store (local.get $pkt) (i32.const 45))))
    (if (i32.eq (local.get $op) (i32.const 88)) (then (i32.store (local.get $pkt) (i32.const 46))))
    (if (i32.and (local.get $vs20) (i32.or (i32.eq (local.get $op) (i32.const 46)) (i32.eq (local.get $op) (i32.const 35)))) (then (i32.store (local.get $pkt) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 84)) (then (i32.store (local.get $pkt) (i32.const 47))))
    (if (i32.and (i32.ge_u (local.get $op) (i32.const 6)) (i32.le_u (local.get $op) (i32.const 7)))
      (then (i32.store (local.get $pkt) (i32.add (local.get $op) (i32.const 14)))))
    (if (i32.and (i32.ge_u (local.get $op) (i32.const 12)) (i32.le_u (local.get $op) (i32.const 19)))
      (then (i32.store (local.get $pkt) (i32.add (local.get $op) (i32.const 10)))))
    (if (i32.and (i32.ge_u (local.get $op) (i32.const 78)) (i32.le_u (local.get $op) (i32.const 80)))
      (then (i32.store (local.get $pkt) (i32.sub (local.get $op) (i32.const 48)))))
    (if (local.get $ps14) (then
      (if (i32.eq (local.get $op) (i32.const 80)) (then (i32.store (local.get $pkt) (i32.const 49))))
      (if (i32.eq (local.get $op) (i32.const 64)) (then (i32.store (local.get $pkt) (i32.const 50))))
      (if (i32.eq (local.get $op) (i32.const 66)) (then (i32.store (local.get $pkt) (i32.const 51))))
      (if (i32.eq (local.get $op) (i32.const 65)) (then (i32.store (local.get $pkt) (i32.const 52))))
      (if (i32.eq (local.get $op) (i32.const 89)) (then (i32.store (local.get $pkt) (i32.const 53))))
      (if (i32.eq (local.get $op) (i32.const 87)) (then (i32.store (local.get $pkt) (i32.const 54))))))
    (i32.store offset=4 (local.get $pkt) (i32.add (i32.shl (i32.load offset=16 (local.get $ins)) (i32.const 7)) (i32.load offset=20 (local.get $ins))))
    (if (i32.and (local.get $vs20) (i32.and (i32.eq (i32.load offset=16 (local.get $ins)) (i32.const 2))
      (i32.ge_u (i32.load offset=20 (local.get $ins)) (i32.const 128)))) (then
      (i32.store offset=4 (local.get $pkt) (i32.add (i32.load offset=20 (local.get $ins)) (i32.const 896)))))
    (i32.store offset=8 (local.get $pkt) (i32.load offset=24 (local.get $ins)))
    ;; TEXCRD invalidates undefined trailing components deterministically.
    (if (i32.eq (i32.load (local.get $pkt)) (i32.const 50)) (then (i32.store offset=8 (local.get $pkt) (i32.const 15))))
    (if (i32.or (i32.eq (i32.load offset=4 (local.get $pkt)) (i32.const 513)) (i32.eq (i32.load offset=4 (local.get $pkt)) (i32.const 514)))
      (then (i32.store offset=8 (local.get $pkt) (i32.const 1))))
    (i32.store offset=12 (local.get $pkt) (i32.or (i32.or (i32.load offset=28 (local.get $ins)) (i32.eq (i32.load offset=4 (local.get $pkt)) (i32.const 513)))
      (select (select (i32.const 16) (i32.const 2) (local.get $vs20)) (i32.const 0)
        (i32.and (i32.eqz (i32.load offset=8 (local.get $ir)))
          (i32.eq (i32.load offset=16 (local.get $ins)) (i32.const 3))))))
    (i32.store offset=12 (local.get $pkt) (i32.or (i32.load offset=12 (local.get $pkt))
      (i32.shl (i32.load offset=12 (local.get $ins)) (i32.const 2))))
    (if (i32.and (local.get $vs20) (i32.eq (local.get $op) (i32.const 35))) (then
      (i32.store offset=12 (local.get $pkt) (i32.or (i32.load offset=12 (local.get $pkt)) (i32.const 32)))))
    (if (i32.and (i32.eq (local.get $op) (i32.const 68))
      (i32.ne (i32.and (i32.load offset=28 (local.get $ir)) (i32.const 4)) (i32.const 0))) (then
      (i32.store offset=12 (local.get $pkt) (i32.or (i32.load offset=12 (local.get $pkt)) (i32.const 8)))))
    (if (i32.eq (local.get $op) (i32.const 81)) (then
      (i32.store (local.get $pkt) (i32.const 14))
      (i32.store offset=8 (local.get $pkt) (i32.const 15))
      (i32.store offset=12 (local.get $pkt) (i32.const 0))
      (i32.store offset=16 (local.get $pkt) (i32.load offset=36 (local.get $ins)))
      (i32.store offset=20 (local.get $pkt) (i32.load offset=52 (local.get $ins)))
      (i32.store offset=24 (local.get $pkt) (i32.load offset=68 (local.get $ins)))
      (i32.store offset=28 (local.get $pkt) (i32.load offset=84 (local.get $ins)))
      (br $skip_emit)))
    (local.set $arity (call $d3d_shader_vm_arity (i32.load (local.get $ins))))
    (if (i32.and (local.get $vs20) (i32.or (i32.eq (local.get $op) (i32.const 46)) (i32.eq (local.get $op) (i32.const 35)))) (then (local.set $arity (i32.const 2))))
    (if (local.get $ps14) (then (local.set $arity (call $d3d_shader_vm_arity14 (local.get $op)))))
    (if (i32.eq (local.get $arity) (i32.const 1)) (then (br $skip_emit)))
    (local.set $j (i32.const 1))
    (loop $sources
      (local.set $operand (i32.add (i32.add (local.get $ins) (i32.const 16)) (i32.shl (local.get $j) (i32.const 4))))
      (i32.store (i32.add (local.get $pkt) (i32.shl (local.get $j) (i32.const 4)))
        (i32.add (i32.shl (i32.load (local.get $operand)) (i32.const 7)) (i32.load offset=4 (local.get $operand))))
      (i32.store offset=4 (i32.add (local.get $pkt) (i32.shl (local.get $j) (i32.const 4))) (i32.load offset=8 (local.get $operand)))
      (i32.store offset=8 (i32.add (local.get $pkt) (i32.shl (local.get $j) (i32.const 4))) (i32.load offset=12 (local.get $operand)))
      (if (i32.and (local.get $vs20) (i32.eq (i32.load (local.get $operand)) (i32.const 2))) (then
        (i32.store offset=8 (i32.add (local.get $pkt) (i32.shl (local.get $j) (i32.const 4)))
          (i32.or (i32.load offset=12 (local.get $operand)) (i32.const 512)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $sources (i32.lt_u (local.get $j) (local.get $arity))))
    )
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $emit)))
    (local.set $pass (i32.add (local.get $pass) (i32.const 1)))
    (local.set $i (i32.const 0)) (br_if $passes (i32.lt_u (local.get $pass) (i32.const 2))))
  (local.get $out))

(func $d3d_shader_vm_context (export "d3d_shader_vm_context") (param $program i32) (param $mask i32) (result i32)
  (local $ctx i32)
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $program) (i32.const 16))) (then (return (i32.const 0))))
  (if (i32.or (i32.ne (i32.load (local.get $program)) (i32.const 0x4453564d))
    (i32.gt_u (local.get $mask) (i32.const 15))) (then (return (i32.const 0))))
  (if (i32.or (i32.ne (i32.load offset=4 (local.get $program)) (i32.const 2))
    (i32.gt_u (i32.load offset=8 (local.get $program)) (i32.const 1024))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load offset=12 (local.get $program))
    (i32.add (i32.const 16) (i32.shl (i32.load offset=8 (local.get $program)) (i32.const 6)))) (then (return (i32.const 0))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $program) (i32.load offset=12 (local.get $program)))) (then (return (i32.const 0))))
  (local.set $ctx (call $heap_alloc (call $d3d_shader_vm_context_bytes)))
  (if (i32.eqz (local.get $ctx)) (then (return (i32.const 0))))
  (local.set $ctx (call $g2w (local.get $ctx)))
  (memory.fill (local.get $ctx) (i32.const 0) (call $d3d_shader_vm_context_bytes))
  (i32.store (local.get $ctx) (i32.const 0x44534358))
  (i32.store offset=4 (local.get $ctx) (local.get $program))
  (i32.store offset=12 (local.get $ctx) (i32.const 1))
  (i32.store offset=16 (local.get $ctx) (local.get $mask))
  (local.get $ctx))

(func $d3d_shader_vm_relative (param $regs i32) (param $index i32) (param $component i32) (param $lane i32) (param $limit i32) (result f32)
  (local $address f32) (local $integer i32)
  ;; Per-lane gather is bounded before forming a register address. Out-of-range
  ;; and non-integer/non-finite dynamic indices match the current GLSL helper's
  ;; explicit zero return; they never index another register bank.
  (local.set $address (f32.add
    (f32.load (i32.add (i32.add (local.get $regs) (i32.const 24576)) (i32.shl (local.get $lane) (i32.const 2))))
    (f32.convert_i32_u (local.get $index))))
  (local.set $integer (i32.trunc_sat_f32_s (local.get $address)))
  (if (i32.or (i32.ge_u (local.get $integer) (local.get $limit))
        (f32.ne (f32.convert_i32_s (local.get $integer)) (local.get $address)))
    (then (return (f32.const 0))))
  ;; c128 starts at ctx+65568, after all legacy sampler records.
  (if (i32.ge_u (local.get $integer) (i32.const 128)) (then
    (local.set $integer (i32.add (local.get $integer) (i32.const 640)))))
  (f32.load (i32.add (i32.add (local.get $regs) (i32.const 16384))
    (i32.add (i32.shl (local.get $integer) (i32.const 6))
      (i32.add (i32.shl (local.get $component) (i32.const 4)) (i32.shl (local.get $lane) (i32.const 2)))))))

(func $d3d_shader_vm_source_row (param $regs i32) (param $src i32) (param $component i32) (param $row i32) (result v128)
  (local $v v128) (local $mod i32) (local $slot i32) (local $select i32) (local $limit i32)
  (local.set $slot (i32.add (i32.load (local.get $src)) (local.get $row)))
  (local.set $select (i32.and (i32.shr_u (i32.load offset=4 (local.get $src)) (i32.shl (local.get $component) (i32.const 1))) (i32.const 3)))
  (if (i32.and (i32.load offset=8 (local.get $src)) (i32.const 256))
    (then
      (local.set $limit (select (i32.const 256) (i32.const 96)
        (i32.and (i32.load offset=8 (local.get $src)) (i32.const 512))))
      (local.set $slot (i32.sub (local.get $slot) (i32.const 256)))
      (local.set $v (f32x4.splat (call $d3d_shader_vm_relative (local.get $regs) (local.get $slot) (local.get $select) (i32.const 0) (local.get $limit))))
      (local.set $v (f32x4.replace_lane 1 (local.get $v) (call $d3d_shader_vm_relative (local.get $regs) (local.get $slot) (local.get $select) (i32.const 1) (local.get $limit))))
      (local.set $v (f32x4.replace_lane 2 (local.get $v) (call $d3d_shader_vm_relative (local.get $regs) (local.get $slot) (local.get $select) (i32.const 2) (local.get $limit))))
      (local.set $v (f32x4.replace_lane 3 (local.get $v) (call $d3d_shader_vm_relative (local.get $regs) (local.get $slot) (local.get $select) (i32.const 3) (local.get $limit)))))
    (else
      (if (i32.and (i32.ne (i32.and (i32.load offset=8 (local.get $src)) (i32.const 512)) (i32.const 0))
        (i32.ge_u (local.get $slot) (i32.const 384))) (then
        (local.set $slot (i32.add (local.get $slot) (i32.const 640)))))
      (local.set $v (v128.load (i32.add (i32.add (local.get $regs) (i32.shl (local.get $slot) (i32.const 6)))
      (i32.shl (local.get $select) (i32.const 4)))))))
  (local.set $mod (i32.and (i32.load offset=8 (local.get $src)) (i32.const 255)))
  (if (i32.or (i32.eq (local.get $mod) (i32.const 2)) (i32.eq (local.get $mod) (i32.const 3)))
    (then (local.set $v (f32x4.sub (local.get $v) (f32x4.splat (f32.const 0.5))))))
  (if (i32.or (i32.eq (local.get $mod) (i32.const 4)) (i32.eq (local.get $mod) (i32.const 5)))
    (then (local.set $v (f32x4.sub (f32x4.mul (local.get $v) (f32x4.splat (f32.const 2))) (f32x4.splat (f32.const 1))))))
  (if (i32.eq (local.get $mod) (i32.const 6)) (then (local.set $v (f32x4.sub (f32x4.splat (f32.const 1)) (local.get $v)))))
  (if (i32.or (i32.eq (local.get $mod) (i32.const 7)) (i32.eq (local.get $mod) (i32.const 8)))
    (then (local.set $v (f32x4.mul (local.get $v) (f32x4.splat (f32.const 2))))))
  (if (i32.or (i32.eq (local.get $mod) (i32.const 8))
    (i32.and (i32.lt_u (local.get $mod) (i32.const 6)) (i32.ne (i32.and (local.get $mod) (i32.const 1)) (i32.const 0))))
    (then (local.set $v (f32x4.neg (local.get $v)))))
  (local.get $v))

(func $d3d_shader_vm_source (param $regs i32) (param $src i32) (param $component i32) (result v128)
  (call $d3d_shader_vm_source_row (local.get $regs) (local.get $src) (local.get $component) (i32.const 0)))

(func $d3d_shader_vm_bind_texture (export "d3d_shader_vm_bind_texture") (param $ctx i32) (param $stage i32) (param $desc i32) (result i32)
  (local $w i32) (local $h i32) (local $pitch i32) (local $format i32) (local $bytes i64)
  (if (i32.or (i32.ge_u (local.get $stage) (i32.const 6))
        (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes)))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (i32.const 0))))
  (if (i32.eqz (local.get $desc)) (then
    (memory.fill (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage))
      (i32.const 0) (i32.const 48)) (return (i32.const 1))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $desc) (i32.const 36))) (then (return (i32.const 0))))
  (local.set $w (i32.load offset=4 (local.get $desc))) (local.set $h (i32.load offset=8 (local.get $desc)))
  (local.set $pitch (i32.load offset=12 (local.get $desc))) (local.set $format (i32.load offset=16 (local.get $desc)))
  (if (i32.or (i32.eqz (local.get $w)) (i32.or (i32.gt_u (local.get $w) (i32.const 2048))
        (i32.or (i32.eqz (local.get $h)) (i32.gt_u (local.get $h) (i32.const 2048))))) (then (return (i32.const 0))))
  (if (i32.or (i32.lt_u (local.get $pitch) (i32.shl (local.get $w) (i32.const 2)))
        (i32.and (i32.ne (local.get $format) (i32.const 0))
          (i32.and (i32.ne (local.get $format) (i32.const 62)) (i32.and (i32.ne (local.get $format) (i32.const 21)) (i32.ne (local.get $format) (i32.const 22))))))
    (then (return (i32.const 0))))
  (if (i32.or (i32.lt_u (i32.load offset=20 (local.get $desc)) (i32.const 1))
        (i32.or (i32.gt_u (i32.load offset=20 (local.get $desc)) (i32.const 4))
        (i32.or (i32.lt_u (i32.load offset=24 (local.get $desc)) (i32.const 1))
        (i32.or (i32.gt_u (i32.load offset=24 (local.get $desc)) (i32.const 4))
        (i32.or (i32.lt_u (i32.load offset=28 (local.get $desc)) (i32.const 1))
          (i32.gt_u (i32.load offset=28 (local.get $desc)) (i32.const 2))))))) (then (return (i32.const 0))))
  (local.set $bytes (i64.add (i64.mul (i64.extend_i32_u (i32.sub (local.get $h) (i32.const 1))) (i64.extend_i32_u (local.get $pitch)))
    (i64.shl (i64.extend_i32_u (local.get $w)) (i64.const 2))))
  (if (i64.gt_u (local.get $bytes) (i64.const 536870912)) (then (return (i32.const 0))))
  (if (i32.eqz (call $d3d_shader_vm_range (i32.load (local.get $desc)) (i32.wrap_i64 (local.get $bytes))))
    (then (return (i32.const 0))))
  (memory.copy (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage))
    (local.get $desc) (i32.const 36))
  (i32.store offset=36 (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)) (i32.const 0))
  (i32.store offset=40 (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)) (i32.const 0))
  (i32.const 1))

(func $d3d_shader_vm_bind_texture_mips (export "d3d_shader_vm_bind_texture_mips")
  (param $ctx i32) (param $stage i32) (param $desc i32) (result i32)
  (local $count i32) (local $table i32) (local $i i32) (local $w i32) (local $h i32)
  (local $level i32) (local $record i32) (local $old i32) (local $format i32) (local $bytes i64)
  (local $faces i32) (local $face i32) (local $firstw i32) (local $firsth i32)
  (if (i32.or (i32.ge_u (local.get $stage) (i32.const 6))
    (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes)))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (i32.const 0))))
  (if (i32.eqz (local.get $desc)) (then (return (call $d3d_shader_vm_bind_texture (local.get $ctx) (local.get $stage) (i32.const 0)))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $desc) (i32.const 64))) (then (return (i32.const 0))))
  (local.set $count (i32.load offset=4 (local.get $desc)))
  (local.set $table (i32.load offset=8 (local.get $desc)))
  (if (i32.gt_u (i32.load offset=60 (local.get $desc)) (i32.const 1)) (then (return (i32.const 0))))
  (local.set $faces (select (i32.const 6) (i32.const 1) (i32.load offset=60 (local.get $desc))))
  (if (i32.or (i32.ne (i32.load (local.get $desc)) (i32.const 1))
    (i32.or (i32.eqz (local.get $count)) (i32.gt_u (local.get $count) (i32.const 12)))) (then (return (i32.const 0))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $table) (i32.shl (i32.mul (local.get $count) (local.get $faces)) (i32.const 4)))) (then (return (i32.const 0))))
  (local.set $format (i32.load offset=12 (local.get $desc)))
  (if (i32.and (i32.ne (local.get $format) (i32.const 0))
    (i32.and (i32.ne (local.get $format) (i32.const 21))
    (i32.and (i32.ne (local.get $format) (i32.const 22)) (i32.ne (local.get $format) (i32.const 62))))) (then (return (i32.const 0))))
  (local.set $i (i32.const 16))
  (loop $modes
    (if (i32.or (i32.lt_u (i32.load (i32.add (local.get $desc) (local.get $i))) (i32.const 1))
      (i32.gt_u (i32.load (i32.add (local.get $desc) (local.get $i))) (i32.const 4))) (then (return (i32.const 0))))
    (local.set $i (i32.add (local.get $i) (i32.const 4))) (br_if $modes (i32.lt_u (local.get $i) (i32.const 24))))
  (local.set $i (i32.const 28))
  (loop $filters
    (if (i32.or (i32.lt_u (i32.load (i32.add (local.get $desc) (local.get $i))) (i32.const 1))
      (i32.gt_u (i32.load (i32.add (local.get $desc) (local.get $i))) (i32.const 2))) (then (return (i32.const 0))))
    (local.set $i (i32.add (local.get $i) (i32.const 4))) (br_if $filters (i32.lt_u (local.get $i) (i32.const 36))))
  (if (i32.or (i32.gt_u (i32.load offset=36 (local.get $desc)) (i32.const 2))
    (i32.or (i32.gt_u (i32.load offset=60 (local.get $desc)) (i32.const 1))
      (i32.eq (i32.and (i32.load offset=40 (local.get $desc)) (i32.const 0x7f800000)) (i32.const 0x7f800000)))) (then (return (i32.const 0))))
  (local.set $w (i32.load offset=52 (local.get $desc))) (local.set $h (i32.load offset=56 (local.get $desc)))
  (if (i32.eq (local.get $faces) (i32.const 6)) (then
    (if (i32.or (i32.ne (local.get $w) (local.get $h))
      (i32.or (i32.ne (i32.load offset=16 (local.get $desc)) (i32.const 3)) (i32.ne (i32.load offset=20 (local.get $desc)) (i32.const 3))))
      (then (return (i32.const 0))))))
  (if (i32.or (i32.eqz (local.get $w)) (i32.or (i32.gt_u (local.get $w) (i32.const 2048))
    (i32.or (i32.eqz (local.get $h)) (i32.gt_u (local.get $h) (i32.const 2048))))) (then (return (i32.const 0))))
  (if (i32.gt_u (i32.load offset=48 (local.get $desc)) (i32.const 11)) (then (return (i32.const 0))))
  (local.set $i (i32.const 0))
  (block $resident (loop $skip
    (br_if $resident (i32.eq (local.get $i) (i32.load offset=48 (local.get $desc))))
    (if (i32.eq (i32.or (local.get $w) (local.get $h)) (i32.const 1)) (then (return (i32.const 0))))
    (local.set $w (select (i32.shr_u (local.get $w) (i32.const 1)) (i32.const 1) (i32.gt_u (local.get $w) (i32.const 1))))
    (local.set $h (select (i32.shr_u (local.get $h) (i32.const 1)) (i32.const 1) (i32.gt_u (local.get $h) (i32.const 1))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $skip)))
  (local.set $firstw (local.get $w)) (local.set $firsth (local.get $h))
  (loop $faces
  (local.set $i (i32.const 0)) (local.set $w (local.get $firstw)) (local.set $h (local.get $firsth))
  (loop $levels
    (local.set $level (i32.add (local.get $table) (i32.shl (i32.add (i32.mul (local.get $face) (local.get $count)) (local.get $i)) (i32.const 4))))
    (if (i32.or (i32.ne (i32.load offset=4 (local.get $level)) (local.get $w))
      (i32.or (i32.ne (i32.load offset=8 (local.get $level)) (local.get $h))
        (i32.lt_u (i32.load offset=12 (local.get $level)) (i32.shl (local.get $w) (i32.const 2))))) (then (return (i32.const 0))))
    (local.set $bytes (i64.add (i64.mul (i64.extend_i32_u (i32.sub (local.get $h) (i32.const 1)))
      (i64.extend_i32_u (i32.load offset=12 (local.get $level)))) (i64.extend_i32_u (i32.shl (local.get $w) (i32.const 2)))))
    (if (i64.gt_u (local.get $bytes) (i64.const 536870912)) (then (return (i32.const 0))))
    (if (i32.eqz (call $d3d_shader_vm_range (i32.load (local.get $level)) (i32.wrap_i64 (local.get $bytes)))) (then (return (i32.const 0))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (if (i32.lt_u (local.get $i) (local.get $count)) (then
      (if (i32.eq (i32.or (local.get $w) (local.get $h)) (i32.const 1)) (then (return (i32.const 0))))
      (local.set $w (select (i32.shr_u (local.get $w) (i32.const 1)) (i32.const 1) (i32.gt_u (local.get $w) (i32.const 1))))
      (local.set $h (select (i32.shr_u (local.get $h) (i32.const 1)) (i32.const 1) (i32.gt_u (local.get $h) (i32.const 1))))
      (br $levels))))
  (local.set $face (i32.add (local.get $face) (i32.const 1))) (br_if $faces (i32.lt_u (local.get $face) (local.get $faces))))
  ;; Publish only after validating every level. Metadata is copied, not retained.
  (local.set $record (call $d3d_shader_vm_mip (local.get $ctx) (local.get $stage)))
  (memory.copy (local.get $record) (local.get $desc) (i32.const 64))
  (memory.copy (i32.add (local.get $record) (i32.const 64)) (local.get $table) (i32.shl (i32.mul (local.get $count) (local.get $faces)) (i32.const 4)))
  (i32.store offset=8 (local.get $record) (i32.add (local.get $record) (i32.const 64)))
  (local.set $old (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)))
  (memory.copy (local.get $old) (local.get $table) (i32.const 16))
  (i32.store offset=16 (local.get $old) (local.get $format))
  (i32.store offset=20 (local.get $old) (i32.load offset=16 (local.get $record)))
  (i32.store offset=24 (local.get $old) (i32.load offset=20 (local.get $record)))
  (i32.store offset=28 (local.get $old) (i32.load offset=28 (local.get $record)))
  (i32.store offset=32 (local.get $old) (i32.load offset=24 (local.get $record)))
  (i32.store offset=36 (local.get $old) (local.get $record))
  (i32.store offset=40 (local.get $old) (i32.const 0)) (i32.const 1))

;; Optional fixed projection uses previously reserved sampler+40, not mip+40
;; (which remains LOD bias). All texture rebinds clear it. No context ABI growth.
(func $d3d_shader_vm_bind_projection (export "d3d_shader_vm_bind_projection")
  (param $ctx i32) (param $stage i32) (param $count i32) (result i32)
  (local $s i32)
  (if (i32.or (i32.ge_u (local.get $stage) (i32.const 6))
    (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes)))) (then (return (i32.const 0))))
  (if (i32.or (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358))
    (i32.and (i32.ne (local.get $count) (i32.const 0))
      (i32.and (i32.ne (local.get $count) (i32.const 3)) (i32.ne (local.get $count) (i32.const 4))))) (then (return (i32.const 0))))
  (local.set $s (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)))
  (if (local.get $count) (then
    (if (i32.eqz (i32.load (local.get $s))) (then (return (i32.const 0))))
    (if (i32.load offset=36 (local.get $s)) (then
      (if (i32.load offset=60 (i32.load offset=36 (local.get $s))) (then (return (i32.const 0))))))))
  (i32.store offset=40 (local.get $s) (local.get $count)) (i32.const 1))

;; Optional versioned bump state, copied independently of pixel bindings.
;; Descriptor28: version1, MAT00,MAT01,MAT10,MAT11,LScale,LOffset (six f32).
;; State belongs to the DESTINATION texture stage for PS TEXBEM/TEXBEML.
;; References: Microsoft texbem---ps, texbeml---ps, bump-map-pixel-formats.
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/texbem---ps
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/texbeml---ps
;; https://learn.microsoft.com/en-us/windows/win32/direct3d9/bump-map-pixel-formats
;; X8L8V8U8 uses max(signedByte/127,-1) SNORM policy; exact legacy driver
;; conversion rounding remains a native-reference gate. Other signed layouts
;; reject at binding rather than being interpreted as unsigned RGBA.
(func $d3d_shader_vm_bind_bump (export "d3d_shader_vm_bind_bump") (param $ctx i32) (param $stage i32) (param $desc i32) (result i32)
  (local $out i32) (local $i i32) (local $value f32)
  (if (i32.or (i32.ge_u (local.get $stage) (i32.const 6))
        (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes)))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (i32.const 0))))
  (local.set $out (call $d3d_shader_vm_bump (local.get $ctx) (local.get $stage)))
  (if (i32.eqz (local.get $desc)) (then (memory.fill (local.get $out) (i32.const 0) (i32.const 32)) (return (i32.const 1))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $desc) (i32.const 28))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load (local.get $desc)) (i32.const 1)) (then (return (i32.const 0))))
  (loop $finite
    (local.set $value (f32.load (i32.add (i32.add (local.get $desc) (i32.const 4)) (i32.shl (local.get $i) (i32.const 2)))))
    (if (i32.or (f32.ne (local.get $value) (local.get $value)) (f32.eq (f32.abs (local.get $value)) (f32.const inf))) (then (return (i32.const 0))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $finite (i32.lt_u (local.get $i) (i32.const 6))))
  (memory.copy (local.get $out) (i32.add (local.get $desc) (i32.const 4)) (i32.const 24))
  (i32.store offset=24 (local.get $out) (i32.const 1))
  (i32.const 1))

(func $d3d_shader_vm_live_mask (export "d3d_shader_vm_live_mask") (param $ctx i32) (result i32)
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (i32.const 0))))
  (i32.and (i32.and (i32.load offset=16 (local.get $ctx)) (i32.const 15))
    (i32.xor (i32.load offset=57568 (local.get $ctx)) (i32.const -1))))

;; Address the integer texel footprint, not merely the central UV. In linear
;; mode BORDER therefore blends each outside tap with the border color.
;; Reference: learn.microsoft.com/windows/win32/direct3d9/bilinear-texture-filtering
;; and /texture-addressing-modes. Point ties choose floor(u*width).
(func $d3d_shader_vm_address (param $x i32) (param $n i32) (param $mode i32) (result i32)
  (local $period i32)
  (if (i32.eq (local.get $mode) (i32.const 1)) (then
    (local.set $x (i32.rem_s (local.get $x) (local.get $n)))
    (return (select (i32.add (local.get $x) (local.get $n)) (local.get $x) (i32.lt_s (local.get $x) (i32.const 0))))))
  (if (i32.eq (local.get $mode) (i32.const 2)) (then
    (local.set $period (i32.shl (local.get $n) (i32.const 1)))
    (local.set $x (i32.rem_s (local.get $x) (local.get $period)))
    (if (i32.lt_s (local.get $x) (i32.const 0)) (then (local.set $x (i32.add (local.get $x) (local.get $period)))))
    (return (select (i32.sub (i32.sub (local.get $period) (local.get $x)) (i32.const 1)) (local.get $x)
      (i32.ge_u (local.get $x) (local.get $n))))))
  (if (i32.eq (local.get $mode) (i32.const 3)) (then
    (if (i32.lt_s (local.get $x) (i32.const 0)) (then (return (i32.const 0))))
    (return (select (i32.sub (local.get $n) (i32.const 1)) (local.get $x) (i32.ge_u (local.get $x) (local.get $n))))))
  (select (i32.const -1) (local.get $x) (i32.ge_u (local.get $x) (local.get $n))))

(func $d3d_shader_vm_texel (param $desc i32) (param $x i32) (param $y i32) (param $comp i32) (result f32)
  (local $value i32) (local $byte i32) (local $format i32)
  (local.set $x (call $d3d_shader_vm_address (local.get $x) (i32.load offset=4 (local.get $desc)) (i32.load offset=20 (local.get $desc))))
  (local.set $y (call $d3d_shader_vm_address (local.get $y) (i32.load offset=8 (local.get $desc)) (i32.load offset=24 (local.get $desc))))
  (if (i32.or (i32.lt_s (local.get $x) (i32.const 0)) (i32.lt_s (local.get $y) (i32.const 0)))
    (then
      (local.set $byte (select (i32.const 24) (i32.shl (i32.sub (i32.const 2) (local.get $comp)) (i32.const 3))
        (i32.eq (local.get $comp) (i32.const 3))))
      (local.set $value (i32.and (i32.shr_u (i32.load offset=32 (local.get $desc)) (local.get $byte)) (i32.const 255))))
    (else
      (local.set $format (i32.load offset=16 (local.get $desc)))
      ;; X8L8V8U8: U,V signed normalized; L unsigned; unused alpha is one.
      (if (i32.eq (local.get $format) (i32.const 62)) (then
        (if (i32.eq (local.get $comp) (i32.const 3)) (then (return (f32.const 1))))
        (local.set $byte (i32.add (i32.load (local.get $desc))
          (i32.add (i32.mul (local.get $y) (i32.load offset=12 (local.get $desc)))
            (i32.add (i32.shl (local.get $x) (i32.const 2)) (local.get $comp)))))
        (if (i32.lt_u (local.get $comp) (i32.const 2)) (then
          (return (f32.max (f32.const -1) (f32.div (f32.convert_i32_s (i32.load8_s (local.get $byte))) (f32.const 127))))))
        (return (f32.div (f32.convert_i32_u (i32.load8_u (local.get $byte))) (f32.const 255)))))
      (if (i32.and (i32.eq (local.get $format) (i32.const 22)) (i32.eq (local.get $comp) (i32.const 3)))
        (then (return (f32.const 1))))
      (local.set $byte (select (i32.sub (i32.const 2) (local.get $comp)) (local.get $comp)
        (i32.and (i32.ne (local.get $format) (i32.const 0)) (i32.lt_u (local.get $comp) (i32.const 3)))))
      (local.set $value (i32.load8_u (i32.add (i32.load (local.get $desc))
        (i32.add (i32.mul (local.get $y) (i32.load offset=12 (local.get $desc)))
          (i32.add (i32.shl (local.get $x) (i32.const 2)) (local.get $byte))))))))
  (f32.div (f32.convert_i32_u (local.get $value)) (f32.const 255)))

(func $d3d_shader_vm_uv (param $u f32) (param $mode i32) (result f32)
  (if (i32.eq (local.get $mode) (i32.const 1)) (then (return (f32.sub (local.get $u) (f32.floor (local.get $u))))))
  (if (i32.eq (local.get $mode) (i32.const 2)) (then
    (local.set $u (f32.sub (local.get $u) (f32.mul (f32.floor (f32.mul (local.get $u) (f32.const 0.5))) (f32.const 2))))
    (return (select (f32.sub (f32.const 2) (local.get $u)) (local.get $u) (f32.gt (local.get $u) (f32.const 1))))))
  ;; Far-out border samples have no in-range taps. Bounded coordinates prevent
  ;; integer overflow even for finite shader values outside native repeat caps.
  (f32.min (f32.max (local.get $u) (select (f32.const 0) (f32.const -1) (i32.eq (local.get $mode) (i32.const 3))))
    (select (f32.const 1) (f32.const 2) (i32.eq (local.get $mode) (i32.const 3)))))

(func $d3d_shader_vm_sample (param $desc i32) (param $u f32) (param $v f32) (param $comp i32) (result f32)
  (local $x i32) (local $y i32) (local $fx f32) (local $fy f32) (local $top f32) (local $bottom f32)
  ;; Undefined/non-finite coordinates follow an explicit zero sampling policy.
  (if (i32.or (f32.ne (local.get $u) (local.get $u)) (i32.or (f32.ne (local.get $v) (local.get $v))
        (i32.or (f32.eq (f32.abs (local.get $u)) (f32.const inf)) (f32.eq (f32.abs (local.get $v)) (f32.const inf)))))
    (then (return (f32.const 0))))
  (local.set $u (f32.mul (call $d3d_shader_vm_uv (local.get $u) (i32.load offset=20 (local.get $desc)))
    (f32.convert_i32_u (i32.load offset=4 (local.get $desc)))))
  (local.set $v (f32.mul (call $d3d_shader_vm_uv (local.get $v) (i32.load offset=24 (local.get $desc)))
    (f32.convert_i32_u (i32.load offset=8 (local.get $desc)))))
  (if (i32.eq (i32.load offset=28 (local.get $desc)) (i32.const 1))
    (then (return (call $d3d_shader_vm_texel (local.get $desc)
      (i32.trunc_sat_f32_s (f32.floor (local.get $u))) (i32.trunc_sat_f32_s (f32.floor (local.get $v))) (local.get $comp)))))
  (local.set $u (f32.sub (local.get $u) (f32.const 0.5))) (local.set $v (f32.sub (local.get $v) (f32.const 0.5)))
  (local.set $x (i32.trunc_sat_f32_s (f32.floor (local.get $u)))) (local.set $y (i32.trunc_sat_f32_s (f32.floor (local.get $v))))
  (local.set $fx (f32.sub (local.get $u) (f32.floor (local.get $u)))) (local.set $fy (f32.sub (local.get $v) (f32.floor (local.get $v))))
  (local.set $top (f32.add
    (f32.mul (call $d3d_shader_vm_texel (local.get $desc) (local.get $x) (local.get $y) (local.get $comp)) (f32.sub (f32.const 1) (local.get $fx)))
    (f32.mul (call $d3d_shader_vm_texel (local.get $desc) (i32.add (local.get $x) (i32.const 1)) (local.get $y) (local.get $comp)) (local.get $fx))))
  (local.set $bottom (f32.add
    (f32.mul (call $d3d_shader_vm_texel (local.get $desc) (local.get $x) (i32.add (local.get $y) (i32.const 1)) (local.get $comp)) (f32.sub (f32.const 1) (local.get $fx)))
    (f32.mul (call $d3d_shader_vm_texel (local.get $desc) (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1)) (local.get $comp)) (local.get $fx))))
  (f32.add (f32.mul (local.get $top) (f32.sub (f32.const 1) (local.get $fy))) (f32.mul (local.get $bottom) (local.get $fy))))

;; Per-context sampler header is a cache only; no shader registers, PC or mask
;; change. Contexts have a single execution owner, as with VM run itself.
(func $d3d_shader_vm_sample_level (param $old i32) (param $mip i32) (param $level i32)
  (param $filter i32) (param $u f32) (param $v f32) (param $comp i32) (result f32)
  (memory.copy (local.get $old) (i32.add (i32.load offset=8 (local.get $mip))
    (i32.shl (local.get $level) (i32.const 4))) (i32.const 16))
  (i32.store offset=28 (local.get $old) (local.get $filter))
  (call $d3d_shader_vm_sample (local.get $old) (local.get $u) (local.get $v) (local.get $comp)))

(func $d3d_shader_vm_sample_face_lod
  (param $ctx i32) (param $stage i32) (param $u f32) (param $v f32) (param $lod f32) (param $comp i32)
  (param $face i32) (result f32)
  (local $old i32) (local $mip i32) (local $first i32) (local $last i32) (local $low i32)
  (local $filter i32) (local $mode i32) (local $level i32) (local $a f32) (local $b f32) (local $fraction f32)
  (if (i32.or (i32.ge_u (local.get $stage) (i32.const 6)) (i32.or (i32.ge_u (local.get $comp) (i32.const 4))
    (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes))))) (then (return (f32.const nan))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (f32.const nan))))
  (if (i32.eq (i32.and (i32.reinterpret_f32 (local.get $lod)) (i32.const 0x7f800000)) (i32.const 0x7f800000)) (then (return (f32.const nan))))
  (local.set $old (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage)))
  (if (i32.eqz (i32.load (local.get $old))) (then (return (f32.const nan))))
  (local.set $mip (i32.load offset=36 (local.get $old)))
  (if (i32.eqz (local.get $mip)) (then
    (if (i32.ne (local.get $face) (i32.const -1)) (then (return (f32.const nan))))
    (return (call $d3d_shader_vm_sample (local.get $old) (local.get $u) (local.get $v) (local.get $comp)))))
  (if (i32.ne (i32.ne (i32.load offset=60 (local.get $mip)) (i32.const 0))
    (i32.ne (local.get $face) (i32.const -1))) (then (return (f32.const nan))))
  (i32.store offset=8 (local.get $mip) (i32.add (i32.add (local.get $mip) (i32.const 64))
    (i32.mul (i32.mul (select (local.get $face) (i32.const 0) (i32.ge_s (local.get $face) (i32.const 0)))
      (i32.load offset=4 (local.get $mip))) (i32.const 16))))
  (local.set $lod (f32.add (local.get $lod) (f32.load offset=40 (local.get $mip))))
  (local.set $filter (select (i32.load offset=32 (local.get $mip)) (i32.load offset=28 (local.get $mip))
    (f32.le (local.get $lod) (f32.const 0))))
  (local.set $first (i32.load offset=48 (local.get $mip)))
  (local.set $last (i32.sub (i32.add (local.get $first) (i32.load offset=4 (local.get $mip))) (i32.const 1)))
  (local.set $low (i32.load offset=44 (local.get $mip)))
  (local.set $low (select (local.get $first) (local.get $low) (i32.lt_u (local.get $low) (local.get $first))))
  (local.set $low (select (local.get $last) (local.get $low) (i32.gt_u (local.get $low) (local.get $last))))
  (local.set $mode (i32.load offset=36 (local.get $mip)))
  (local.set $lod (f32.min (f32.max (local.get $lod) (f32.convert_i32_u (local.get $low))) (f32.convert_i32_u (local.get $last))))
  (if (i32.eqz (local.get $mode)) (then (local.set $lod (f32.convert_i32_u (local.get $low)))))
  (if (i32.eq (local.get $mode) (i32.const 1)) (then (local.set $lod (f32.floor (f32.add (local.get $lod) (f32.const 0.5))))))
  (local.set $level (i32.sub (i32.trunc_sat_f32_u (local.get $lod)) (local.get $first)))
  (local.set $a (call $d3d_shader_vm_sample_level (local.get $old) (local.get $mip) (local.get $level)
    (local.get $filter) (local.get $u) (local.get $v) (local.get $comp)))
  (local.set $fraction (f32.sub (local.get $lod) (f32.floor (local.get $lod))))
  (if (i32.or (i32.ne (local.get $mode) (i32.const 2)) (f32.eq (local.get $fraction) (f32.const 0))) (then (return (local.get $a))))
  (local.set $b (call $d3d_shader_vm_sample_level (local.get $old) (local.get $mip) (i32.add (local.get $level) (i32.const 1))
    (local.get $filter) (local.get $u) (local.get $v) (local.get $comp)))
  (f32.add (f32.mul (local.get $a) (f32.sub (f32.const 1) (local.get $fraction))) (f32.mul (local.get $b) (local.get $fraction))))

(func $d3d_shader_vm_sample_lod (export "d3d_shader_vm_sample_lod")
  (param $ctx i32) (param $stage i32) (param $u f32) (param $v f32) (param $lod f32) (param $comp i32) (result f32)
  (call $d3d_shader_vm_sample_face_lod (local.get $ctx) (local.get $stage) (local.get $u) (local.get $v)
    (local.get $lod) (local.get $comp) (i32.const -1)))

;; Cube face convention: +X,-X,+Y,-Y,+Z,-Z, matching D3DCUBEMAP_FACES.
;; Projection table is OpenGL 2.1 table 3.19 (same D3D face orientation).
;; Exact-axis ties use X then Y then Z; zero/nonfinite directions return NaN.
;; Face-local clamp filtering is explicit; seamless cross-face filtering is not
;; claimed. The binder rejects non-CLAMP cube addressing in this first slice.
(func $d3d_shader_vm_cube_face (export "d3d_shader_vm_cube_face")
  (param $x f32) (param $y f32) (param $z f32) (result i32)
  (local $a f32) (local $b f32) (local $c f32)
  (local.set $a (f32.abs (local.get $x))) (local.set $b (f32.abs (local.get $y))) (local.set $c (f32.abs (local.get $z)))
  (if (i32.or (i32.or (f32.ne (local.get $x) (local.get $x)) (f32.ne (local.get $y) (local.get $y)))
    (i32.or (f32.ne (local.get $z) (local.get $z)) (f32.eq (f32.max (local.get $a) (f32.max (local.get $b) (local.get $c))) (f32.const inf))))
    (then (return (i32.const -1))))
  (if (f32.eq (f32.max (local.get $a) (f32.max (local.get $b) (local.get $c))) (f32.const 0)) (then (return (i32.const -1))))
  (if (i32.and (f32.ge (local.get $a) (local.get $b)) (f32.ge (local.get $a) (local.get $c)))
    (then (return (select (i32.const 1) (i32.const 0) (f32.lt (local.get $x) (f32.const 0))))))
  (if (f32.ge (local.get $b) (local.get $c))
    (then (return (select (i32.const 3) (i32.const 2) (f32.lt (local.get $y) (f32.const 0))))))
  (select (i32.const 5) (i32.const 4) (f32.lt (local.get $z) (f32.const 0))))

(func $d3d_shader_vm_cube_uv (export "d3d_shader_vm_cube_uv")
  (param $face i32) (param $x f32) (param $y f32) (param $z f32) (param $component i32) (result f32)
  (local $major f32) (local $sc f32) (local $tc f32)
  (if (i32.or (i32.ge_u (local.get $face) (i32.const 6)) (i32.ge_u (local.get $component) (i32.const 2))) (then (return (f32.const nan))))
  (if (i32.lt_u (local.get $face) (i32.const 2)) (then
    (local.set $major (f32.abs (local.get $x)))
    (local.set $sc (select (local.get $z) (f32.neg (local.get $z)) (i32.eq (local.get $face) (i32.const 1))))
    (local.set $tc (f32.neg (local.get $y)))) (else
    (if (i32.lt_u (local.get $face) (i32.const 4)) (then
      (local.set $major (f32.abs (local.get $y))) (local.set $sc (local.get $x))
      (local.set $tc (select (f32.neg (local.get $z)) (local.get $z) (i32.eq (local.get $face) (i32.const 3))))) (else
      (local.set $major (f32.abs (local.get $z)))
      (local.set $sc (select (f32.neg (local.get $x)) (local.get $x) (i32.eq (local.get $face) (i32.const 5))))
      (local.set $tc (f32.neg (local.get $y)))))))
  (f32.mul (f32.const 0.5) (f32.add (f32.const 1) (f32.div
    (select (local.get $tc) (local.get $sc) (local.get $component)) (local.get $major)))))

(func $d3d_shader_vm_sample_cube_lod (export "d3d_shader_vm_sample_cube_lod")
  (param $ctx i32) (param $stage i32) (param $x f32) (param $y f32) (param $z f32)
  (param $lod f32) (param $comp i32) (result f32) (local $face i32)
  (local.set $face (call $d3d_shader_vm_cube_face (local.get $x) (local.get $y) (local.get $z)))
  (if (i32.lt_s (local.get $face) (i32.const 0)) (then (return (f32.const nan))))
  (call $d3d_shader_vm_sample_face_lod (local.get $ctx) (local.get $stage)
    (call $d3d_shader_vm_cube_uv (local.get $face) (local.get $x) (local.get $y) (local.get $z) (i32.const 0))
    (call $d3d_shader_vm_cube_uv (local.get $face) (local.get $x) (local.get $y) (local.get $z) (i32.const 1))
    (local.get $lod) (local.get $comp) (local.get $face)))

;; Native SIMD transcendental policy: ordinary non-fused f32 operations,
;; retained subnormals, NaN propagation, IEEE overflow/underflow. EXP2 uses a
;; degree-8 exp(r*ln2) polynomial with r in [-.5,.5]; LOG2 uses exponent/mantissa
;; reduction and 2*atanh((m-1)/(m+1)) through z^17. No imported host math.
;; Independent tests bound normal EXP relative error and LOG absolute error.
;; Exact historical GPU bit identity remains a native-reference gate.
;; EXP normal relative error <=2^-21 in the independent fixture sweep; LOG
;; absolute error includes final f32 exponent rounding. This is an explicit
;; adapter policy, not a claim to reproduce every legacy GPU's internal format.
(func $d3d_shader_vm_exp2 (param $a v128) (result v128)
  (local $x v128) (local $n v128) (local $r v128) (local $p v128)
  (local $scale v128) (local $extra v128) (local $v v128)
  (local.set $x (f32x4.min (f32x4.max (local.get $a) (f32x4.splat (f32.const -150))) (f32x4.splat (f32.const 128))))
  (local.set $n (i32x4.trunc_sat_f32x4_s (f32x4.floor (f32x4.add (local.get $x) (f32x4.splat (f32.const 0.5))))))
  (local.set $r (f32x4.sub (local.get $x) (f32x4.convert_i32x4_s (local.get $n))))
  (local.set $p (f32x4.splat (f32.const 0.0000013215486790144305)))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.00001525273380405984))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.000154035303933816))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.0013333558146428443))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.009618129107628477))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.05550410866482158))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.2402265069591007))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 0.6931471805599453))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $r)) (f32x4.splat (f32.const 1))))
  (local.set $scale (i32x4.min_s (i32x4.max_s (local.get $n) (i32x4.splat (i32.const -126))) (i32x4.splat (i32.const 127))))
  (local.set $extra (i32x4.shl (i32x4.add (i32x4.sub (local.get $n) (local.get $scale)) (i32x4.splat (i32.const 127))) (i32.const 23)))
  (local.set $scale (i32x4.shl (i32x4.add (local.get $scale) (i32x4.splat (i32.const 127))) (i32.const 23)))
  (local.set $v (f32x4.mul (f32x4.mul (local.get $p) (local.get $extra)) (local.get $scale)))
  (local.set $v (v128.bitselect (f32x4.splat (f32.const 0)) (local.get $v) (f32x4.lt (local.get $a) (f32x4.splat (f32.const -150)))))
  (v128.bitselect (f32x4.splat (f32.const inf)) (local.get $v) (f32x4.ge (local.get $a) (f32x4.splat (f32.const 128)))))

(func $d3d_shader_vm_log2 (param $a v128) (result v128)
  (local $x v128) (local $sub v128) (local $e v128) (local $m v128)
  (local $z v128) (local $z2 v128) (local $p v128) (local $v v128)
  (local.set $a (f32x4.abs (local.get $a)))
  (local.set $sub (f32x4.lt (local.get $a) (f32x4.splat (f32.const 1.1754943508222875e-38))))
  (local.set $x (v128.bitselect (f32x4.mul (local.get $a) (f32x4.splat (f32.const 8388608))) (local.get $a) (local.get $sub)))
  (local.set $e (i32x4.sub (i32x4.sub (i32x4.shr_u (local.get $x) (i32.const 23)) (i32x4.splat (i32.const 127))) (v128.and (local.get $sub) (i32x4.splat (i32.const 23)))))
  (local.set $m (v128.or (v128.and (local.get $x) (i32x4.splat (i32.const 0x007fffff))) (i32x4.splat (i32.const 0x3f800000))))
  (local.set $z (f32x4.div (f32x4.sub (local.get $m) (f32x4.splat (f32.const 1))) (f32x4.add (local.get $m) (f32x4.splat (f32.const 1)))))
  (local.set $z2 (f32x4.mul (local.get $z) (local.get $z)))
  (local.set $p (f32x4.splat (f32.const 0.058823529411764705)))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.06666666666666667))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.07692307692307693))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.09090909090909091))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.1111111111111111))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.14285714285714285))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.2))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 0.3333333333333333))))
  (local.set $p (f32x4.add (f32x4.mul (local.get $p) (local.get $z2)) (f32x4.splat (f32.const 1))))
  (local.set $v (f32x4.add (f32x4.convert_i32x4_s (local.get $e)) (f32x4.mul (f32x4.mul (local.get $z) (local.get $p)) (f32x4.splat (f32.const 2.8853900817779268)))))
  (local.set $v (v128.bitselect (f32x4.splat (f32.const -inf)) (local.get $v) (f32x4.eq (local.get $a) (f32x4.splat (f32.const 0)))))
  (local.set $v (v128.bitselect (local.get $a) (local.get $v) (f32x4.eq (local.get $a) (f32x4.splat (f32.const inf)))))
  (v128.bitselect (local.get $a) (local.get $v) (f32x4.ne (local.get $a) (local.get $a))))

(func $d3d_shader_vm_alu (param $op i32) (param $a v128) (param $b v128) (param $c v128) (result v128)
  ;; Dedicated static dispatch, not the x86 function table. No recursive NEXT.
  (block $bad (block $max (block $min (block $mul (block $mad (block $sub (block $add (block $mov
    (br_table $mov $add $sub $mad $mul $bad $bad $min $max $bad (local.get $op)))
    (return (local.get $a)))
    (return (f32x4.add (local.get $a) (local.get $b))))
    (return (f32x4.sub (local.get $a) (local.get $b))))
    (return (f32x4.add (f32x4.mul (local.get $a) (local.get $b)) (local.get $c))))
    (return (f32x4.mul (local.get $a) (local.get $b))))
    (return (f32x4.min (local.get $a) (local.get $b))))
    (return (f32x4.max (local.get $a) (local.get $b))))
  (unreachable))

;; Appended static handler IDs20..32: RCP,RSQ,SLT,SGE,EXP,LOG,LIT,DST,
;; LRP,FRC,EXPP,LOGP,CND. Native math references:
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/exp---vs
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/logp---vs
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/lit---vs
;; RCP/RSQ zero yields infinity (the prose contract and current GL behavior).
;; a0 MOV's existing floor policy is unchanged pending native-driver comparison.
(func $d3d_shader_vm_extended (param $regs i32) (param $pkt i32) (param $comp i32) (result v128)
  (local $op i32) (local $a v128) (local $b v128) (local $c v128)
  (local $scalar v128) (local $power v128) (local $y v128)
  (local.set $op (i32.load (local.get $pkt)))
  (if (i32.eq (local.get $op) (i32.const 46)) (then
    (return (v128.bitselect
      (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (local.get $comp))
      (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 48)) (local.get $comp))
      (f32x4.ge (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $comp)) (f32x4.splat (f32.const 0)))))))
  (local.set $a (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $comp)))
  (local.set $b (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (local.get $comp)))
  (local.set $c (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 48)) (local.get $comp)))
  (local.set $scalar (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0)))
  (if (i32.eq (local.get $op) (i32.const 20)) (then (return (f32x4.div (f32x4.splat (f32.const 1)) (local.get $scalar)))))
  (if (i32.eq (local.get $op) (i32.const 21)) (then (return (f32x4.div (f32x4.splat (f32.const 1)) (f32x4.sqrt (f32x4.abs (local.get $scalar)))))))
  (if (i32.eq (local.get $op) (i32.const 22)) (then (return (f32x4.convert_i32x4_s (v128.and (f32x4.lt (local.get $a) (local.get $b)) (i32x4.splat (i32.const 1)))))))
  (if (i32.eq (local.get $op) (i32.const 23)) (then (return (f32x4.convert_i32x4_s (v128.and (f32x4.ge (local.get $a) (local.get $b)) (i32x4.splat (i32.const 1)))))))
  (if (i32.eq (local.get $op) (i32.const 24)) (then (return (call $d3d_shader_vm_exp2 (local.get $scalar)))))
  (if (i32.eq (local.get $op) (i32.const 25)) (then (return (call $d3d_shader_vm_log2 (local.get $scalar)))))
  (if (i32.eq (local.get $op) (i32.const 26)) (then (if (i32.or (i32.eq (local.get $comp) (i32.const 0)) (i32.eq (local.get $comp) (i32.const 3))) (then (return (f32x4.splat (f32.const 1))))) (if (i32.eq (local.get $comp) (i32.const 1)) (then (return (f32x4.max (local.get $scalar) (f32x4.splat (f32.const 0)))))) (local.set $y (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 1))) (local.set $power (f32x4.min (f32x4.max (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 3)) (f32x4.splat (f32.const -127.9961))) (f32x4.splat (f32.const 127.9961)))) (return (v128.bitselect (call $d3d_shader_vm_exp2 (f32x4.mul (call $d3d_shader_vm_log2 (local.get $y)) (local.get $power))) (f32x4.splat (f32.const 0)) (v128.and (f32x4.gt (local.get $scalar) (f32x4.splat (f32.const 0))) (f32x4.gt (local.get $y) (f32x4.splat (f32.const 0))))))))
  (if (i32.eq (local.get $op) (i32.const 27)) (then (if (i32.eq (local.get $comp) (i32.const 0)) (then (return (f32x4.splat (f32.const 1))))) (if (i32.eq (local.get $comp) (i32.const 1)) (then (return (f32x4.mul (local.get $a) (local.get $b))))) (return (select (local.get $a) (local.get $b) (i32.eq (local.get $comp) (i32.const 2))))))
  (if (i32.eq (local.get $op) (i32.const 28)) (then (return (f32x4.add (f32x4.mul (local.get $a) (local.get $b)) (f32x4.mul (f32x4.sub (f32x4.splat (f32.const 1)) (local.get $a)) (local.get $c))))))
  (if (i32.eq (local.get $op) (i32.const 29)) (then (return (f32x4.sub (local.get $a) (f32x4.floor (local.get $a))))))
  (if (i32.eq (local.get $op) (i32.const 30)) (then (if (i32.eq (local.get $comp) (i32.const 0)) (then (return (call $d3d_shader_vm_exp2 (f32x4.floor (local.get $scalar)))))) (if (i32.eq (local.get $comp) (i32.const 1)) (then (return (f32x4.sub (local.get $scalar) (f32x4.floor (local.get $scalar)))))) (if (i32.eq (local.get $comp) (i32.const 2)) (then (return (call $d3d_shader_vm_exp2 (local.get $scalar))))) (return (f32x4.splat (f32.const 1)))))
  (if (i32.eq (local.get $op) (i32.const 31)) (then (return (v128.bitselect (f32x4.splat (f32.const -3.4028234663852886e+38)) (call $d3d_shader_vm_log2 (local.get $scalar)) (f32x4.eq (local.get $scalar) (f32x4.splat (f32.const 0)))))))
  (if (i32.eq (local.get $op) (i32.const 32)) (then (return (v128.bitselect (local.get $b) (local.get $c) (f32x4.gt (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 3)) (f32x4.splat (f32.const 0.5)))))))
  (unreachable))

;; PS1.1 TEXM3x2 and TEXM3x3: source RGB dot ORIGINAL destination-stage UVW.
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/texm3x2tex---ps
;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/texm3x3tex---ps
;; Source _bx2 is allowed by the PS1.x source-modifier specification.
;; PAD stores only hidden U at ctx+57584; no sampler or guest t write occurs.
(func $d3d_shader_vm_texdot (param $regs i32) (param $pkt i32) (result v128)
  (local $coords i32) (local $v v128) (local $i i32)
  (local.set $coords (i32.add (local.get $regs) (i32.shl
    (i32.sub (i32.load offset=4 (local.get $pkt)) (i32.const 240)) (i32.const 6))))
  (local.set $v (f32x4.splat (f32.const 0)))
  (loop $dot
    (local.set $v (f32x4.add (local.get $v) (f32x4.mul
      (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $i))
      (v128.load (i32.add (local.get $coords) (i32.shl (local.get $i) (i32.const 4)))))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $dot (i32.lt_u (local.get $i) (i32.const 3))))
  (local.get $v))

;; Fine 2x2 finite differences before addressing, lane order TL/TR/BL/BR.
;; Isotropic footprint lambda=.5*log2(max(dot(dx,dx),dot(dy,dy))).
;; Exact legacy vendor LOD thresholds/precision remain native-reference gates.
;; No shader-visible derivative opcodes or anisotropic filtering are claimed.
(func $d3d_shader_vm_quad_lod (param $mip i32) (param $u v128) (param $v v128) (result v128)
  (local $ux v128) (local $uy v128) (local $vx v128) (local $vy v128) (local $rho v128)
  (local.set $u (f32x4.mul (local.get $u) (f32x4.splat (f32.convert_i32_u (i32.load offset=52 (local.get $mip))))))
  (local.set $v (f32x4.mul (local.get $v) (f32x4.splat (f32.convert_i32_u (i32.load offset=56 (local.get $mip))))))
  (local.set $ux (f32x4.sub (local.get $u) (i8x16.shuffle 4 5 6 7 0 1 2 3 12 13 14 15 8 9 10 11 (local.get $u) (local.get $u))))
  (local.set $vx (f32x4.sub (local.get $v) (i8x16.shuffle 4 5 6 7 0 1 2 3 12 13 14 15 8 9 10 11 (local.get $v) (local.get $v))))
  (local.set $uy (f32x4.sub (local.get $u) (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7 (local.get $u) (local.get $u))))
  (local.set $vy (f32x4.sub (local.get $v) (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7 (local.get $v) (local.get $v))))
  (local.set $rho (f32x4.max (f32x4.add (f32x4.mul (local.get $ux) (local.get $ux)) (f32x4.mul (local.get $vx) (local.get $vx)))
    (f32x4.add (f32x4.mul (local.get $uy) (local.get $uy)) (f32x4.mul (local.get $vy) (local.get $vy)))))
  ;; Zero footprint selects magnification; huge finite differences saturate to
  ;; the last level without passing infinity to the explicit-LOD validator.
  (f32x4.mul (f32x4.splat (f32.const 0.5)) (call $d3d_shader_vm_log2
    (f32x4.min (f32x4.max (local.get $rho) (f32x4.splat (f32.const 1e-30))) (f32x4.splat (f32.const 1e30))))))

(func $d3d_shader_vm_lane (param $v v128) (param $lane i32) (result f32)
  (if (result f32) (i32.lt_u (local.get $lane) (i32.const 2)) (then
    (select (f32x4.extract_lane 1 (local.get $v)) (f32x4.extract_lane 0 (local.get $v)) (local.get $lane))) (else
    (select (f32x4.extract_lane 3 (local.get $v)) (f32x4.extract_lane 2 (local.get $v)) (i32.and (local.get $lane) (i32.const 1))))))

;; Derivative helper directions are projected onto the RECEIVING lane's face,
;; not their own face. Otherwise crossing a cube edge fabricates a UV jump.
(func $d3d_shader_vm_cube_quad_sample
  (param $ctx i32) (param $stage i32) (param $x v128) (param $y v128) (param $z v128)
  (param $lane i32) (param $comp i32) (result f32)
  (local $face i32) (local $i i32) (local $n i32) (local $mip i32)
  (local $u f32) (local $v f32) (local $du f32) (local $dv f32) (local $rho f32) (local $size f32)
  (local.set $face (call $d3d_shader_vm_cube_face (call $d3d_shader_vm_lane (local.get $x) (local.get $lane))
    (call $d3d_shader_vm_lane (local.get $y) (local.get $lane)) (call $d3d_shader_vm_lane (local.get $z) (local.get $lane))))
  (if (i32.lt_s (local.get $face) (i32.const 0)) (then (return (f32.const nan))))
  (local.set $mip (i32.load offset=36 (call $d3d_shader_vm_sampler (local.get $ctx) (local.get $stage))))
  (local.set $size (f32.convert_i32_u (i32.load offset=52 (local.get $mip))))
  (local.set $u (call $d3d_shader_vm_cube_uv (local.get $face) (call $d3d_shader_vm_lane (local.get $x) (local.get $lane))
    (call $d3d_shader_vm_lane (local.get $y) (local.get $lane)) (call $d3d_shader_vm_lane (local.get $z) (local.get $lane)) (i32.const 0)))
  (local.set $v (call $d3d_shader_vm_cube_uv (local.get $face) (call $d3d_shader_vm_lane (local.get $x) (local.get $lane))
    (call $d3d_shader_vm_lane (local.get $y) (local.get $lane)) (call $d3d_shader_vm_lane (local.get $z) (local.get $lane)) (i32.const 1)))
  (local.set $i (i32.const 1))
  (loop $neighbors
    (local.set $n (i32.xor (local.get $lane) (local.get $i)))
    (local.set $du (f32.mul (local.get $size) (f32.sub (local.get $u)
      (call $d3d_shader_vm_cube_uv (local.get $face) (call $d3d_shader_vm_lane (local.get $x) (local.get $n))
        (call $d3d_shader_vm_lane (local.get $y) (local.get $n)) (call $d3d_shader_vm_lane (local.get $z) (local.get $n)) (i32.const 0)))))
    (local.set $dv (f32.mul (local.get $size) (f32.sub (local.get $v)
      (call $d3d_shader_vm_cube_uv (local.get $face) (call $d3d_shader_vm_lane (local.get $x) (local.get $n))
        (call $d3d_shader_vm_lane (local.get $y) (local.get $n)) (call $d3d_shader_vm_lane (local.get $z) (local.get $n)) (i32.const 1)))))
    (local.set $rho (f32.max (local.get $rho) (f32.add (f32.mul (local.get $du) (local.get $du)) (f32.mul (local.get $dv) (local.get $dv)))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $neighbors (i32.le_u (local.get $i) (i32.const 2))))
  (call $d3d_shader_vm_sample_face_lod (local.get $ctx) (local.get $stage) (local.get $u) (local.get $v)
    (f32.mul (f32.const 0.5) (f32x4.extract_lane 0 (call $d3d_shader_vm_log2
      (f32x4.splat (f32.min (f32.max (local.get $rho) (f32.const 1e-30)) (f32.const 1e30))))))
    (local.get $comp) (local.get $face)))

(func $d3d_shader_vm_coord14 (param $regs i32) (param $pkt i32) (param $comp i32) (result v128)
  (local $src i32) (local $base i32) (local $v v128) (local $den v128)
  (local.set $src (i32.add (local.get $pkt) (i32.const 16)))
  (local.set $base (i32.add (local.get $regs) (i32.shl (i32.load (local.get $src)) (i32.const 6))))
  (local.set $v (v128.load (i32.add (local.get $base) (i32.shl
    (i32.and (i32.shr_u (i32.load offset=4 (local.get $src)) (i32.shl (local.get $comp) (i32.const 1))) (i32.const 3)) (i32.const 4)))))
  (if (i32.and (i32.ne (i32.load offset=8 (local.get $src)) (i32.const 0)) (i32.lt_u (local.get $comp) (i32.const 2))) (then
    (local.set $den (v128.load (i32.add (local.get $base)
      (select (i32.const 48) (i32.const 32) (i32.eq (i32.load offset=8 (local.get $src)) (i32.const 10))))))
    (local.set $v (v128.bitselect (f32x4.splat (f32.const 1)) (f32x4.div (local.get $v) (local.get $den))
      (f32x4.eq (local.get $den) (f32x4.splat (f32.const 0)))))))
  (local.get $v))

(func $d3d_shader_vm_component (param $regs i32) (param $pkt i32) (param $comp i32) (result v128)
  (local $op i32) (local $v v128) (local $j i32) (local $size i32) (local $rows i32)
  (local $desc i32) (local $stage i32) (local $u v128) (local $t v128)
  (local $lod v128)
  (local $bump i32) (local $du v128) (local $dv v128)
  (local $projected i32) (local $q v128) (local $valid v128)
  (local $ex v128) (local $ey v128) (local $ez v128) (local $reflection v128)
  (local.set $op (i32.load (local.get $pkt)))
  (if (i32.or (i32.eq (local.get $op) (i32.const 48)) (i32.eq (local.get $op) (i32.const 52))) (then (return (f32x4.splat (f32.const 0)))))
  (if (i32.eq (local.get $op) (i32.const 49)) (then (return (v128.bitselect
    (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (local.get $comp))
    (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 48)) (local.get $comp))
    (f32x4.gt (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $comp)) (f32x4.splat (f32.const 0.5)))))))
  (if (i32.eq (local.get $op) (i32.const 50)) (then
    (if (i32.ge_u (local.get $comp) (select (i32.const 2) (i32.const 3) (i32.ne (i32.load offset=24 (local.get $pkt)) (i32.const 0)))) (then (return (f32x4.splat (f32.const 0)))))
    (return (call $d3d_shader_vm_coord14 (local.get $regs) (local.get $pkt) (local.get $comp)))))
  (if (i32.eq (local.get $op) (i32.const 53)) (then
    (if (i32.ge_u (local.get $comp) (i32.const 2)) (then (return (f32x4.splat (f32.const 0)))))
    (local.set $bump (call $d3d_shader_vm_bump (i32.sub (local.get $regs) (i32.const 32)) (i32.load offset=4 (local.get $pkt))))
    (return (f32x4.add (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $comp))
      (f32x4.add (f32x4.mul (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 0))
        (v128.load32_splat (i32.add (local.get $bump) (i32.shl (local.get $comp) (i32.const 2)))))
        (f32x4.mul (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 1))
          (v128.load32_splat (i32.add (local.get $bump) (i32.add (i32.const 8) (i32.shl (local.get $comp) (i32.const 2)))))))))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 47)) (i32.eq (local.get $op) (i32.const 54))) (then
    (if (i32.eq (local.get $op) (i32.const 47)) (then
    (local.set $v (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))
    (local.set $v (v128.bitselect (f32x4.splat (f32.const 1))
      (f32x4.div (v128.load (i32.add (local.get $regs) (i32.const 57552))) (local.get $v))
      (f32x4.eq (local.get $v) (f32x4.splat (f32.const 0)))))))
    (if (i32.eq (local.get $op) (i32.const 54)) (then
      (local.set $t (v128.load offset=336 (local.get $regs)))
      (local.set $v (v128.bitselect (f32x4.splat (f32.const 1)) (f32x4.div (v128.load offset=320 (local.get $regs)) (local.get $t))
        (f32x4.eq (local.get $t) (f32x4.splat (f32.const 0)))))))
    ;; Defined range is[0,1]; explicit policy for undefined out-of-range is
    ;; clamp, with NaN->1. Not a claim of historic native undefined behavior.
    (local.set $v (v128.bitselect (f32x4.splat (f32.const 1)) (local.get $v) (f32x4.ne (local.get $v) (local.get $v))))
    (return (f32x4.min (f32x4.max (local.get $v) (f32x4.splat (f32.const 0))) (f32x4.splat (f32.const 1))))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 46)) (i32.and (i32.ge_u (local.get $op) (i32.const 20)) (i32.le_u (local.get $op) (i32.const 32))))
    (then (return (call $d3d_shader_vm_extended (local.get $regs) (local.get $pkt) (local.get $comp)))))
  (if (i32.eq (local.get $op) (i32.const 44)) (then (return (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))))
  (if (i32.eq (local.get $op) (i32.const 45)) (then
    (if (i32.lt_u (local.get $comp) (i32.const 2)) (then (return
      (v128.load (i32.add (i32.add (local.get $regs) (i32.const 62752)) (i32.shl (local.get $comp) (i32.const 4)))))))
    (if (i32.eq (local.get $comp) (i32.const 2)) (then (return (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))))
    (return (f32x4.splat (f32.const 1)))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 36)) (i32.eq (local.get $op) (i32.const 38))) (then (return (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))))
  (if (i32.eq (local.get $op) (i32.const 18)) (then (return (f32x4.splat (f32.const 0)))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 51)) (i32.or (i32.and (i32.ge_u (local.get $op) (i32.const 16)) (i32.le_u (local.get $op) (i32.const 19)))
        (i32.and (i32.ge_u (local.get $op) (i32.const 33)) (i32.le_u (local.get $op) (i32.const 43))))) (then
    (local.set $stage (i32.sub (i32.load offset=4 (local.get $pkt)) (i32.const 384)))
    (if (i32.eq (local.get $op) (i32.const 51)) (then (local.set $stage (i32.load offset=4 (local.get $pkt)))))
    (local.set $desc (call $d3d_shader_vm_sampler (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage)))
    (local.set $j (i32.add (local.get $regs) (i32.shl (i32.add (local.get $stage) (i32.const 144)) (i32.const 6))))
    (if (i32.eq (local.get $op) (i32.const 17))
      (then
        ;; PS1.1-1.3 TEXCOORD always writes alpha1, regardless of input Q.
        (if (i32.eq (local.get $comp) (i32.const 3)) (then (return (f32x4.splat (f32.const 1)))))
        (return (f32x4.min (f32x4.max (v128.load (i32.add (local.get $j) (i32.shl (local.get $comp) (i32.const 4))))
        (f32x4.splat (f32.const 0))) (f32x4.splat (f32.const 1))))))
    (if (i32.load offset=36 (local.get $desc)) (then
      (if (i32.load offset=60 (i32.load offset=36 (local.get $desc))) (then
        (local.set $u (v128.load (local.get $j))) (local.set $t (v128.load offset=16 (local.get $j)))
        (local.set $du (v128.load offset=32 (local.get $j)))
        (if (i32.eq (local.get $op) (i32.const 51)) (then
          (local.set $u (call $d3d_shader_vm_coord14 (local.get $regs) (local.get $pkt) (i32.const 0)))
          (local.set $t (call $d3d_shader_vm_coord14 (local.get $regs) (local.get $pkt) (i32.const 1)))
          (local.set $du (call $d3d_shader_vm_coord14 (local.get $regs) (local.get $pkt) (i32.const 2)))))
        (if (i32.and (i32.ge_u (local.get $op) (i32.const 39)) (i32.le_u (local.get $op) (i32.const 41))) (then
          (local.set $u (v128.load (i32.add (local.get $regs) (i32.const 62752))))
          (local.set $t (v128.load (i32.add (local.get $regs) (i32.const 62768))))
          (local.set $du (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))))
        ;; SPEC/VSPEC: R=2*(N.E)/(N.N)*N-E. Normal need not be unit length.
        ;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/texm3x3spec---ps
        ;; VSPEC eye xyz are ORIGINAL row Qs, never overwritten t.w values.
        ;; Zero normal follows IEEE 0/0 -> NaN, then invalid cube direction;
        ;; exact native degeneracy/overflow policy remains a reference gate.
        (if (i32.eq (local.get $op) (i32.const 42)) (then
          (local.set $u (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0)))
          (local.set $t (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 1)))
          (local.set $du (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 2)))))
        (if (i32.and (i32.ge_u (local.get $op) (i32.const 40)) (i32.le_u (local.get $op) (i32.const 41))) (then
          (if (i32.eq (local.get $op) (i32.const 40)) (then
            (local.set $ex (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 0)))
            (local.set $ey (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 1)))
            (local.set $ez (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 2)))) (else
            (local.set $ex (v128.load (i32.sub (local.get $j) (i32.const 80))))
            (local.set $ey (v128.load (i32.sub (local.get $j) (i32.const 16))))
            (local.set $ez (v128.load offset=48 (local.get $j)))))
          (local.set $reflection (f32x4.div (f32x4.mul (f32x4.splat (f32.const 2))
            (f32x4.add (f32x4.add (f32x4.mul (local.get $u) (local.get $ex)) (f32x4.mul (local.get $t) (local.get $ey))) (f32x4.mul (local.get $du) (local.get $ez))))
            (f32x4.add (f32x4.add (f32x4.mul (local.get $u) (local.get $u)) (f32x4.mul (local.get $t) (local.get $t))) (f32x4.mul (local.get $du) (local.get $du)))))
          (local.set $u (f32x4.sub (f32x4.mul (local.get $reflection) (local.get $u)) (local.get $ex)))
          (local.set $t (f32x4.sub (f32x4.mul (local.get $reflection) (local.get $t)) (local.get $ey)))
          (local.set $du (f32x4.sub (f32x4.mul (local.get $reflection) (local.get $du)) (local.get $ez)))))
        (local.set $v (f32x4.splat (call $d3d_shader_vm_cube_quad_sample (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (local.get $u) (local.get $t) (local.get $du) (i32.const 0) (local.get $comp))))
        (local.set $v (f32x4.replace_lane 1 (local.get $v) (call $d3d_shader_vm_cube_quad_sample (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (local.get $u) (local.get $t) (local.get $du) (i32.const 1) (local.get $comp))))
        (local.set $v (f32x4.replace_lane 2 (local.get $v) (call $d3d_shader_vm_cube_quad_sample (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (local.get $u) (local.get $t) (local.get $du) (i32.const 2) (local.get $comp))))
        (return (f32x4.replace_lane 3 (local.get $v) (call $d3d_shader_vm_cube_quad_sample (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (local.get $u) (local.get $t) (local.get $du) (i32.const 3) (local.get $comp))))))))
    (if (i32.eq (local.get $op) (i32.const 19)) (then
      (local.set $u (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 3)))
      (local.set $t (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0))))
    (else (local.set $u (v128.load (local.get $j))) (local.set $t (v128.load offset=16 (local.get $j)))))
    (local.set $projected (select (i32.load offset=40 (local.get $desc)) (i32.const 0) (i32.eq (local.get $op) (i32.const 16))))
    (if (local.get $projected) (then
      (local.set $q (v128.load (i32.add (local.get $j) (i32.shl (i32.sub (local.get $projected) (i32.const 1)) (i32.const 4)))))
      (local.set $valid (v128.and (f32x4.ne (local.get $q) (f32x4.splat (f32.const 0)))
        (f32x4.le (f32x4.abs (local.get $q)) (f32x4.splat (f32.const 3.4028234663852886e38)))))
      (local.set $q (v128.bitselect (local.get $q) (f32x4.splat (f32.const 1)) (local.get $valid)))
      (local.set $u (f32x4.div (local.get $u) (local.get $q))) (local.set $t (f32x4.div (local.get $t) (local.get $q)))
      (local.set $valid (v128.and (local.get $valid) (v128.and
        (f32x4.le (f32x4.abs (local.get $u)) (f32x4.splat (f32.const 3.4028234663852886e38)))
        (f32x4.le (f32x4.abs (local.get $t)) (f32x4.splat (f32.const 3.4028234663852886e38))))))
      ;; Invalid projected lanes deterministically sample transparent black.
      ;; Sanitized helper coordinates bound LOD; no Windows-equivalence claim.
      (local.set $u (v128.and (local.get $u) (local.get $valid)))
      (local.set $t (v128.and (local.get $t) (local.get $valid)))))
    (if (i32.eq (local.get $op) (i32.const 51)) (then
      (local.set $u (call $d3d_shader_vm_coord14 (local.get $regs) (local.get $pkt) (i32.const 0)))
      (local.set $t (call $d3d_shader_vm_coord14 (local.get $regs) (local.get $pkt) (i32.const 1)))))
    (if (i32.eq (local.get $op) (i32.const 35)) (then
      (local.set $u (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 1)))
      (local.set $t (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 2)))))
    (if (i32.and (i32.ge_u (local.get $op) (i32.const 33)) (i32.le_u (local.get $op) (i32.const 34))) (then
      (local.set $bump (call $d3d_shader_vm_bump (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage)))
      (local.set $du (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0)))
      (local.set $dv (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 1)))
      (local.set $u (f32x4.add (local.get $u) (f32x4.add
        (f32x4.mul (local.get $du) (v128.load32_splat (local.get $bump)))
        (f32x4.mul (local.get $dv) (v128.load32_splat offset=8 (local.get $bump))))))
      (local.set $t (f32x4.add (local.get $t) (f32x4.add
        (f32x4.mul (local.get $du) (v128.load32_splat offset=4 (local.get $bump)))
        (f32x4.mul (local.get $dv) (v128.load32_splat offset=12 (local.get $bump))))))))
    (if (i32.eq (local.get $op) (i32.const 37)) (then
      (local.set $u (v128.load (i32.add (local.get $regs) (i32.const 57552))))
      (local.set $t (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))))
    (if (i32.eq (local.get $op) (i32.const 42)) (then
      (local.set $u (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0)))
      (local.set $t (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 1)))))
    (if (i32.eq (local.get $op) (i32.const 43)) (then
      (local.set $u (call $d3d_shader_vm_texdot (local.get $regs) (local.get $pkt)))
      (local.set $t (f32x4.splat (f32.const 0)))))
    (if (i32.load offset=36 (local.get $desc)) (then
      (local.set $lod (call $d3d_shader_vm_quad_lod (i32.load offset=36 (local.get $desc)) (local.get $u) (local.get $t)))
      (local.set $v (f32x4.splat (call $d3d_shader_vm_sample_lod (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (f32x4.extract_lane 0 (local.get $u)) (f32x4.extract_lane 0 (local.get $t)) (f32x4.extract_lane 0 (local.get $lod)) (local.get $comp))))
      (local.set $v (f32x4.replace_lane 1 (local.get $v) (call $d3d_shader_vm_sample_lod (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (f32x4.extract_lane 1 (local.get $u)) (f32x4.extract_lane 1 (local.get $t)) (f32x4.extract_lane 1 (local.get $lod)) (local.get $comp))))
      (local.set $v (f32x4.replace_lane 2 (local.get $v) (call $d3d_shader_vm_sample_lod (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (f32x4.extract_lane 2 (local.get $u)) (f32x4.extract_lane 2 (local.get $t)) (f32x4.extract_lane 2 (local.get $lod)) (local.get $comp))))
      (local.set $v (f32x4.replace_lane 3 (local.get $v) (call $d3d_shader_vm_sample_lod (i32.sub (local.get $regs) (i32.const 32)) (local.get $stage) (f32x4.extract_lane 3 (local.get $u)) (f32x4.extract_lane 3 (local.get $t)) (f32x4.extract_lane 3 (local.get $lod)) (local.get $comp)))))
    (else
    (local.set $v (f32x4.splat (call $d3d_shader_vm_sample (local.get $desc) (f32x4.extract_lane 0 (local.get $u)) (f32x4.extract_lane 0 (local.get $t)) (local.get $comp))))
    (local.set $v (f32x4.replace_lane 1 (local.get $v) (call $d3d_shader_vm_sample (local.get $desc) (f32x4.extract_lane 1 (local.get $u)) (f32x4.extract_lane 1 (local.get $t)) (local.get $comp))))
    (local.set $v (f32x4.replace_lane 2 (local.get $v) (call $d3d_shader_vm_sample (local.get $desc) (f32x4.extract_lane 2 (local.get $u)) (f32x4.extract_lane 2 (local.get $t)) (local.get $comp))))
    (local.set $v (f32x4.replace_lane 3 (local.get $v) (call $d3d_shader_vm_sample (local.get $desc) (f32x4.extract_lane 3 (local.get $u)) (f32x4.extract_lane 3 (local.get $t)) (local.get $comp))))))
    (if (i32.eq (local.get $op) (i32.const 34)) (then
      (if (i32.and (i32.ne (i32.and (i32.load offset=12 (local.get $pkt)) (i32.const 8)) (i32.const 0))
        (i32.eq (local.get $comp) (i32.const 3))) (then (return (local.get $v))))
      (local.set $du (f32x4.add
        (f32x4.mul (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 2))
          (v128.load32_splat offset=16 (local.get $bump)))
        (v128.load32_splat offset=20 (local.get $bump))))
      (if (i32.and (i32.load offset=12 (local.get $pkt)) (i32.const 8)) (then
        (local.set $du (f32x4.min (f32x4.max (local.get $du) (f32x4.splat (f32.const 0))) (f32x4.splat (f32.const 1))))))
      (local.set $v (f32x4.mul (local.get $v) (local.get $du)))))
    (if (local.get $projected) (then (local.set $v (v128.and (local.get $v) (local.get $valid)))))
    (return (local.get $v))))
  (if (i32.eq (local.get $op) (i32.const 15)) (then (return (f32x4.splat (f32.const 0)))))
  (if (i32.eq (local.get $op) (i32.const 14))
    (then (return (f32x4.splat (f32.load (i32.add (i32.add (local.get $pkt) (i32.const 16)) (i32.shl (local.get $comp) (i32.const 2))))))))
  (if (i32.and (i32.ge_u (local.get $op) (i32.const 9)) (i32.le_u (local.get $op) (i32.const 13)))
    (then
      (local.set $size (select (i32.const 4) (i32.const 3) (i32.le_u (local.get $op) (i32.const 10))))
      (local.set $rows (select (i32.const 4)
        (select (i32.const 2) (i32.const 3) (i32.eq (local.get $op) (i32.const 13)))
        (i32.or (i32.eq (local.get $op) (i32.const 9)) (i32.eq (local.get $op) (i32.const 11)))))
      (if (i32.ge_u (local.get $comp) (local.get $rows)) (then (return (f32x4.splat (f32.const 0)))))
      (local.set $v (f32x4.mul
        (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0))
        (call $d3d_shader_vm_source_row (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 0) (local.get $comp))))
      (local.set $j (i32.const 1))
      (loop $matrix_dot
        (local.set $v (f32x4.add (local.get $v) (f32x4.mul
          (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $j))
          (call $d3d_shader_vm_source_row (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (local.get $j) (local.get $comp)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br_if $matrix_dot (i32.lt_u (local.get $j) (local.get $size))))
      (return (local.get $v))))
  (if (i32.or (i32.eq (local.get $op) (i32.const 5)) (i32.eq (local.get $op) (i32.const 6)))
    (then
      (local.set $v (f32x4.mul (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (i32.const 0))
        (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (i32.const 0))))
      (local.set $j (i32.const 1))
      (loop $dot
        (local.set $v (f32x4.add (local.get $v) (f32x4.mul
          (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $j))
          (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (local.get $j)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br_if $dot (i32.lt_u (local.get $j) (select (i32.const 3) (i32.const 4) (i32.eq (local.get $op) (i32.const 5))))))
      (return (local.get $v))))
  (call $d3d_shader_vm_alu (local.get $op)
    (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 16)) (local.get $comp))
    (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 32)) (local.get $comp))
    (call $d3d_shader_vm_source (local.get $regs) (i32.add (local.get $pkt) (i32.const 48)) (local.get $comp))))

(func $d3d_shader_vm_write (param $dst i32) (param $v v128) (param $mask v128) (param $sat i32)
  (local $shift i32)
  (if (i32.and (local.get $sat) (i32.const 2)) (then (local.set $v (f32x4.floor (local.get $v)))))
  ;; MOVA requires nearest. Microsoft leaves exact ties unspecified; use Wasm
  ;; nearest-even deterministically, without altering legacy MOV-a0 floor.
  ;; https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/mova---vs
  (if (i32.and (local.get $sat) (i32.const 16)) (then (local.set $v (f32x4.nearest (local.get $v)))))
  (if (i32.and (local.get $sat) (i32.const 32)) (then (local.set $v (f32x4.abs (local.get $v)))))
  (local.set $shift (i32.shr_s (i32.shl (local.get $sat) (i32.const 16)) (i32.const 24)))
  (if (local.get $shift) (then
    (local.set $v (f32x4.mul (local.get $v)
      (f32x4.splat (f32.reinterpret_i32 (i32.shl (i32.add (local.get $shift) (i32.const 127)) (i32.const 23))))))))
  (if (i32.and (local.get $sat) (i32.const 1)) (then (local.set $v (f32x4.min (f32x4.max (local.get $v) (f32x4.splat (f32.const 0))) (f32x4.splat (f32.const 1))))))
  (v128.store (local.get $dst) (v128.bitselect (local.get $v) (v128.load (local.get $dst)) (local.get $mask))))

(func $d3d_shader_vm_commit (param $regs i32) (param $pkt i32) (param $x v128) (param $y v128) (param $z v128) (param $w v128) (param $mask v128)
  (local $dst i32) (local $wm i32) (local $sat i32)
  (local.set $dst (i32.add (local.get $regs) (i32.shl (i32.load offset=4 (local.get $pkt)) (i32.const 6))))
  (local.set $wm (i32.load offset=8 (local.get $pkt)))
  (local.set $sat (i32.load offset=12 (local.get $pkt)))
  (if (i32.and (local.get $wm) (i32.const 1)) (then (call $d3d_shader_vm_write (i32.add (local.get $dst) (i32.const 0)) (local.get $x) (local.get $mask) (local.get $sat))))
  (if (i32.and (local.get $wm) (i32.const 2)) (then (call $d3d_shader_vm_write (i32.add (local.get $dst) (i32.const 16)) (local.get $y) (local.get $mask) (local.get $sat))))
  (if (i32.and (local.get $wm) (i32.const 4)) (then (call $d3d_shader_vm_write (i32.add (local.get $dst) (i32.const 32)) (local.get $z) (local.get $mask) (local.get $sat))))
  (if (i32.and (local.get $wm) (i32.const 8)) (then (call $d3d_shader_vm_write (i32.add (local.get $dst) (i32.const 48)) (local.get $w) (local.get $mask) (local.get $sat))))
)

;; Single execution owner; cancellation may be published concurrently. Never
;; overwrite cancellation with a late yield/error/completion status. A pair
;; already executing finishes BOTH masked commits before observing cancellation
;; at the next scheduling boundary (not hardware-atomic vector memory stores).
(func $d3d_shader_vm_status (param $ctx i32) (param $value i32) (result i32)
  (local $previous i32)
  (loop $publish
    (local.set $previous (i32.atomic.load offset=12 (local.get $ctx)))
    (if (i32.eq (local.get $previous) (i32.const -2)) (then (return (i32.const -2))))
    (if (i32.eq (i32.atomic.rmw.cmpxchg offset=12 (local.get $ctx) (local.get $previous) (local.get $value)) (local.get $previous))
      (then (return (local.get $value))))
    (br $publish))
  (unreachable))
(func $d3d_shader_vm_cancel (export "d3d_shader_vm_cancel") (param $ctx i32)
  (if (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes))
    (then (if (i32.eq (i32.load (local.get $ctx)) (i32.const 0x44534358))
      (then (i32.atomic.store offset=12 (local.get $ctx) (i32.const -2)))))))

(func $d3d_shader_vm_run (export "d3d_shader_vm_run") (param $ctx i32) (param $budget i32) (result i32)
  (local $program i32) (local $n i32) (local $pc i32) (local $pkt i32) (local $regs i32)
  (local $dst i32) (local $bits i32) (local $mask v128)
  (local $op i32) (local $desc i32) (local $partner i32) (local $step i32) (local $j i32)
  (local $x2 v128) (local $y2 v128) (local $z2 v128) (local $w2 v128)
  (local $x v128) (local $y v128) (local $z v128) (local $w v128)
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes))) (then (return (i32.const -1))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (i32.const -1))))
  (if (i32.eq (i32.atomic.load offset=12 (local.get $ctx)) (i32.const -2)) (then (return (i32.const -2))))
  (local.set $program (i32.load offset=4 (local.get $ctx)))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $program) (i32.const 16))) (then (return (i32.const -1))))
  (if (i32.or (i32.ne (i32.load (local.get $program)) (i32.const 0x4453564d))
    (i32.ne (i32.load offset=4 (local.get $program)) (i32.const 2))) (then (return (i32.const -1))))
  (local.set $n (i32.load offset=8 (local.get $program)))
  (if (i32.gt_u (local.get $n) (i32.const 1024)) (then (return (i32.const -1))))
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $program) (i32.add (i32.const 16) (i32.shl (local.get $n) (i32.const 6))))) (then (return (i32.const -1))))
  (local.set $pc (i32.load offset=8 (local.get $ctx)))
  (if (i32.gt_u (local.get $pc) (local.get $n)) (then (return (i32.const -1))))
  (local.set $regs (i32.add (local.get $ctx) (i32.const 32)))
  (if (i32.eqz (local.get $pc)) (then
    (i32.store offset=57568 (local.get $ctx) (i32.const 0))
    (i32.store offset=62832 (local.get $ctx) (i32.const 0))
    ;; Original t0..5 coordinates occupy private v16..21, safely below the
    ;; constant bank at16384. Fixed TEX4/5 must retain their XYZ for cube LOD.
    (memory.copy (i32.add (local.get $regs) (i32.const 9216)) (i32.add (local.get $regs) (i32.const 24576)) (i32.const 384))))
  (local.set $bits (i32.load offset=16 (local.get $ctx)))
  (if (i32.load offset=24 (local.get $ctx)) (then
    (local.set $bits (i32.or (local.get $bits) (i32.load offset=24 (local.get $ctx))))))
  (local.set $mask (i32x4.ne (v128.and (i32x4.splat (local.get $bits)) (v128.const i32x4 1 2 4 8)) (v128.const i32x4 0 0 0 0)))
  (block $done (loop $next
    (if (i32.eq (i32.atomic.load offset=12 (local.get $ctx)) (i32.const -2)) (then (return (i32.const -2))))
    (br_if $done (i32.ge_u (local.get $pc) (local.get $n)))
    (if (i32.le_s (local.get $budget) (i32.const 0)) (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const 1)))))
    (local.set $pkt (i32.add (i32.add (local.get $program) (i32.const 16)) (i32.shl (local.get $pc) (i32.const 6))))
    (local.set $op (i32.load (local.get $pkt)))
    (if (i32.and (i32.load offset=12 (local.get $pkt)) (i32.const 4)) (then (return (i32.const -1))))
    (local.set $partner (i32.const 0)) (local.set $step (i32.const 1))
    (if (i32.lt_u (i32.add (local.get $pc) (i32.const 1)) (local.get $n)) (then
      (if (i32.and (i32.load offset=76 (local.get $pkt)) (i32.const 4)) (then
        (local.set $partner (i32.add (local.get $pkt) (i32.const 64))) (local.set $step (i32.const 2))))))
    (if (i32.lt_s (local.get $budget) (local.get $step))
      (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const 1)))))
    (if (i32.eq (local.get $op) (i32.const 51)) (then
      (local.set $desc (call $d3d_shader_vm_sampler (local.get $ctx) (i32.load offset=4 (local.get $pkt))))
      (if (i32.eqz (i32.load (local.get $desc))) (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))
      (if (i32.load offset=36 (local.get $desc)) (then
        (if (i32.ne (i32.and (local.get $bits) (i32.const 15)) (i32.const 15)) (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -4)))))
        (if (i32.and (i32.ne (i32.load offset=24 (local.get $pkt)) (i32.const 0))
          (i32.ne (i32.load offset=60 (i32.load offset=36 (local.get $desc))) (i32.const 0)))
          (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))))))
    (if (i32.eq (local.get $op) (i32.const 53)) (then
      (local.set $desc (call $d3d_shader_vm_bump (local.get $ctx) (i32.load offset=4 (local.get $pkt))))
      (if (i32.eqz (i32.load offset=24 (local.get $desc))) (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))))
    (if (i32.eq (local.get $op) (i32.const 48)) (then
      (local.set $j (i32.const 0))
      (loop $phase_alpha
        (local.set $dst (i32.add (local.get $regs) (i32.add (i32.const 48) (i32.shl (local.get $j) (i32.const 6)))))
        (v128.store (local.get $dst) (v128.bitselect (f32x4.splat (f32.const 0)) (v128.load (local.get $dst)) (local.get $mask)))
        (local.set $j (i32.add (local.get $j) (i32.const 1))) (br_if $phase_alpha (i32.lt_u (local.get $j) (i32.const 6))))))
    (if (i32.or (i32.or (i32.eq (local.get $op) (i32.const 16)) (i32.eq (local.get $op) (i32.const 19)))
          (i32.and (i32.and (i32.ne (local.get $op) (i32.const 36)) (i32.ne (local.get $op) (i32.const 38)))
            (i32.and (i32.ge_u (local.get $op) (i32.const 33)) (i32.le_u (local.get $op) (i32.const 43))))) (then
      (local.set $desc (call $d3d_shader_vm_sampler (local.get $ctx)
        (i32.sub (i32.load offset=4 (local.get $pkt)) (i32.const 384))))
      (if (i32.eqz (i32.load (local.get $desc)))
        (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))
      (if (i32.load offset=36 (local.get $desc)) (then
        (if (i32.and (i32.ne (i32.load offset=60 (i32.load offset=36 (local.get $desc))) (i32.const 0))
          (i32.and (i32.ne (local.get $op) (i32.const 16)) (i32.or (i32.lt_u (local.get $op) (i32.const 39)) (i32.gt_u (local.get $op) (i32.const 42)))))
          (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))))
      (if (i32.and (i32.ge_u (local.get $op) (i32.const 39)) (i32.le_u (local.get $op) (i32.const 41))) (then
        (if (i32.eqz (i32.load offset=36 (local.get $desc))) (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))
        (if (i32.eqz (i32.load offset=60 (i32.load offset=36 (local.get $desc)))) (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))))
      (if (i32.and (i32.ne (i32.load offset=36 (local.get $desc)) (i32.const 0))
            (i32.ne (i32.and (local.get $bits) (i32.const 15)) (i32.const 15)))
        (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -4)))))))
    (if (i32.and (i32.ge_u (local.get $op) (i32.const 33)) (i32.le_u (local.get $op) (i32.const 34))) (then
      (local.set $desc (call $d3d_shader_vm_bump (local.get $ctx)
        (i32.sub (i32.load offset=4 (local.get $pkt)) (i32.const 384))))
      (if (i32.eqz (i32.load offset=24 (local.get $desc)))
        (then (return (call $d3d_shader_vm_status (local.get $ctx) (i32.const -3)))))))
    (if (i32.or (i32.eq (local.get $op) (i32.const 18)) (i32.eq (local.get $op) (i32.const 52))) (then
      ;; PS1.1-1.3 TEXKILL reads original interpolated coordinates, not mutable
      ;; t# data. PC0 preserved those in v16..21 (flat144..149).
      (local.set $dst (i32.add (local.get $regs) (i32.shl (i32.sub (i32.load offset=4 (local.get $pkt)) (i32.const 240)) (i32.const 6))))
      (if (i32.eq (local.get $op) (i32.const 52)) (then
        (local.set $dst (i32.add (local.get $regs) (i32.shl (i32.load offset=4 (local.get $pkt)) (i32.const 6))))))
      (local.set $x (v128.or (f32x4.lt (v128.load (local.get $dst)) (f32x4.splat (f32.const 0)))
        (v128.or (f32x4.lt (v128.load offset=16 (local.get $dst)) (f32x4.splat (f32.const 0)))
          (f32x4.lt (v128.load offset=32 (local.get $dst)) (f32x4.splat (f32.const 0))))))
      (i32.store offset=57568 (local.get $ctx) (i32.or (i32.load offset=57568 (local.get $ctx))
        (i32.and (local.get $bits) (i32x4.bitmask (local.get $x)))))))
    ;; Snapshot ALL source-dependent components before any destination store.
    (local.set $x (call $d3d_shader_vm_component (local.get $regs) (local.get $pkt) (i32.const 0)))
    (if (i32.eq (local.get $op) (i32.const 36)) (then
      (v128.store (i32.add (local.get $ctx) (i32.const 57584))
        (v128.bitselect (local.get $x) (v128.load (i32.add (local.get $ctx) (i32.const 57584))) (local.get $mask)))))
    ;; Validated PS1.1 3x3 sequence necessarily uses PAD t1 then PAD t2,
    ;; source t0, final TEX t3. Hidden U/V live in stage3 tail padding.
    (if (i32.eq (local.get $op) (i32.const 38)) (then
      (local.set $dst (i32.add (local.get $ctx) (i32.add (i32.const 62784)
        (i32.shl (i32.sub (i32.load offset=4 (local.get $pkt)) (i32.const 385)) (i32.const 4)))))
      (v128.store (local.get $dst) (v128.bitselect (local.get $x) (v128.load (local.get $dst)) (local.get $mask)))))
    (local.set $y (call $d3d_shader_vm_component (local.get $regs) (local.get $pkt) (i32.const 1)))
    (local.set $z (call $d3d_shader_vm_component (local.get $regs) (local.get $pkt) (i32.const 2)))
    (local.set $w (call $d3d_shader_vm_component (local.get $regs) (local.get $pkt) (i32.const 3)))
    ;; Both packets finish source-dependent work before either can write.
    (if (local.get $partner) (then
      (local.set $x2 (call $d3d_shader_vm_component (local.get $regs) (local.get $partner) (i32.const 0)))
      (local.set $y2 (call $d3d_shader_vm_component (local.get $regs) (local.get $partner) (i32.const 1)))
      (local.set $z2 (call $d3d_shader_vm_component (local.get $regs) (local.get $partner) (i32.const 2)))
      (local.set $w2 (call $d3d_shader_vm_component (local.get $regs) (local.get $partner) (i32.const 3)))))
    (if (i32.or (i32.eq (local.get $op) (i32.const 47)) (i32.eq (local.get $op) (i32.const 54))) (then
      (v128.store offset=62816 (local.get $ctx) (v128.bitselect (local.get $x) (v128.load offset=62816 (local.get $ctx)) (local.get $mask)))
      (i32.store offset=62832 (local.get $ctx) (i32.const 1))))
    (if (i32.and (i32.and (i32.ne (local.get $op) (i32.const 48)) (i32.and (i32.ne (local.get $op) (i32.const 52)) (i32.ne (local.get $op) (i32.const 54))))
      (i32.and (i32.ne (local.get $op) (i32.const 47)) (i32.and (i32.ne (local.get $op) (i32.const 18)) (i32.and (i32.ne (local.get $op) (i32.const 36)) (i32.ne (local.get $op) (i32.const 38)))))) (then
      (call $d3d_shader_vm_commit (local.get $regs) (local.get $pkt) (local.get $x) (local.get $y) (local.get $z) (local.get $w) (local.get $mask))))
    (if (local.get $partner) (then
      (call $d3d_shader_vm_commit (local.get $regs) (local.get $partner) (local.get $x2) (local.get $y2) (local.get $z2) (local.get $w2) (local.get $mask))))
    (local.set $pc (i32.add (local.get $pc) (local.get $step)))
    (i32.store offset=8 (local.get $ctx) (local.get $pc))
    (i32.store offset=20 (local.get $ctx) (i32.add (i32.load offset=20 (local.get $ctx)) (local.get $step)))
    (local.set $budget (i32.sub (local.get $budget) (local.get $step)))
    (br $next)))
  (call $d3d_shader_vm_status (local.get $ctx) (i32.const 0)))

(func $d3d_shader_vm_depth_valid (export "d3d_shader_vm_depth_valid") (param $ctx i32) (result i32)
  (if (i32.eqz (call $d3d_shader_vm_range (local.get $ctx) (call $d3d_shader_vm_context_bytes))) (then (return (i32.const 0))))
  (if (i32.ne (i32.load (local.get $ctx)) (i32.const 0x44534358)) (then (return (i32.const 0))))
  (i32.load offset=62832 (local.get $ctx)))
(func $d3d_shader_vm_depth (export "d3d_shader_vm_depth") (param $ctx i32) (param $lane i32) (result f32)
  (if (i32.or (i32.ge_u (local.get $lane) (i32.const 4)) (i32.eqz (call $d3d_shader_vm_depth_valid (local.get $ctx))))
    (then (return (f32.const nan))))
  (f32.load (i32.add (i32.add (local.get $ctx) (i32.const 62816)) (i32.shl (local.get $lane) (i32.const 2)))))
