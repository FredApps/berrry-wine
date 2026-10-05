'use strict';
// Test-only deterministic allocation faults around the actual production
// allocators. No exported guest handler, source or browser instrumentation.
const extraWat=String.raw`
(global $vb_test_fault_active (mut i32) (i32.const 0))
(global $vb_test_heap_fail (mut i32) (i32.const 0))
(global $vb_test_dib_fail (mut i32) (i32.const 0))
(global $vb_test_heap_live (mut i32) (i32.const 0))
(global $vb_test_dib_live (mut i32) (i32.const 0))
(func (export "vb_fault_arm") (param $heap i32) (param $dib i32)
 (global.set $vb_test_heap_fail (local.get $heap)) (global.set $vb_test_dib_fail (local.get $dib))
 (global.set $vb_test_heap_live (i32.const 0)) (global.set $vb_test_dib_live (i32.const 0))
 (global.set $vb_test_fault_active (i32.const 1)))
(func (export "vb_fault_disarm") (global.set $vb_test_fault_active (i32.const 0)))
(func (export "vb_heap_balance") (result i32) (global.get $vb_test_heap_live))
(func (export "vb_dib_balance") (result i32) (global.get $vb_test_dib_live))
(func $heap_alloc (param $size i32) (result i32)
 (local $p i32)
 (if (i32.and (global.get $vb_test_fault_active) (i32.gt_s (global.get $vb_test_heap_fail) (i32.const 0))) (then
  (global.set $vb_test_heap_fail (i32.sub (global.get $vb_test_heap_fail) (i32.const 1)))
  (if (i32.eqz (global.get $vb_test_heap_fail)) (then (return (i32.const 0))))))
 (local.set $p (call $vb_test_real_heap_alloc (local.get $size)))
 (if (i32.and (global.get $vb_test_fault_active) (i32.ne (local.get $p) (i32.const 0)))
  (then (global.set $vb_test_heap_live (i32.add (global.get $vb_test_heap_live) (i32.const 1)))))
 (local.get $p))
(func $heap_free (param $p i32)
 (call $vb_test_real_heap_free (local.get $p))
 (if (i32.and (global.get $vb_test_fault_active) (i32.ne (local.get $p) (i32.const 0)))
  (then (global.set $vb_test_heap_live (i32.sub (global.get $vb_test_heap_live) (i32.const 1))))))
(func $dib_alloc (param $size i32) (result i32)
 (local $p i32)
 (if (i32.and (global.get $vb_test_fault_active) (i32.gt_s (global.get $vb_test_dib_fail) (i32.const 0))) (then
  (global.set $vb_test_dib_fail (i32.sub (global.get $vb_test_dib_fail) (i32.const 1)))
  (if (i32.eqz (global.get $vb_test_dib_fail)) (then (return (i32.const 0))))))
 (local.set $p (call $vb_test_real_dib_alloc (local.get $size)))
 (if (i32.and (global.get $vb_test_fault_active) (i32.ne (local.get $p) (i32.const 0)))
  (then (global.set $vb_test_dib_live (i32.add (global.get $vb_test_dib_live) (i32.const 1)))))
 (local.get $p))
(func $dib_free_wasm (param $p i32)
 (call $vb_test_real_dib_free_wasm (local.get $p))
 (if (i32.and (global.get $vb_test_fault_active) (i32.ne (local.get $p) (i32.const 0)))
  (then (global.set $vb_test_dib_live (i32.sub (global.get $vb_test_dib_live) (i32.const 1))))))
`;
function transform(file,text){
 if(file!=='10-helpers.wat')return text;
 for(const name of ['heap_alloc','heap_free','dib_alloc','dib_free_wasm']){
  const pattern=`(func $${name} `;if(text.split(pattern).length!==2)throw Error('Allocator definition changed: '+name);
  text=text.replace(pattern,`(func $vb_test_real_${name} `);
 }
 return text;
}
module.exports={extraWat,transform};
