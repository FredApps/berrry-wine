#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');

// Execute the real x87 opcode handlers; only their test entrypoints are added.
const extra = String.raw`
 (func (export "fld") (param $addr i32)
   (call $fpu_exec_mem (i32.const 5) (i32.const 0) (local.get $addr)))
 (func (export "st") (param $i i32) (result f64) (call $fpu_get (local.get $i)))
 (func (export "fstp") (param $addr i32)
   (call $fpu_exec_mem (i32.const 5) (i32.const 3) (local.get $addr)))
 (func (export "fild") (param $addr i32)
   (call $fpu_exec_mem (i32.const 7) (i32.const 5) (local.get $addr)))
 (func (export "fistp") (param $addr i32)
   (call $fpu_exec_mem (i32.const 7) (i32.const 7) (local.get $addr)))
 (func (export "save") (param $addr i32)
   (call $fpu_exec_mem (i32.const 5) (i32.const 6) (local.get $addr)))
 (func (export "restore") (param $addr i32)
   (call $fpu_exec_mem (i32.const 5) (i32.const 4) (local.get $addr)))
 (func (export "top") (result i32) (global.get $fpu_top))
 (func (export "tags") (result i32) (global.get $fpu_tag))
`;
const binary = compileSrcWasm((file, source) => file === '13-exports.wat' ? source + extra : source);
const module_ = new WebAssembly.Module(binary);
const memory = new WebAssembly.Memory({ initial:8192, maximum:8192, shared:true });
const imports = { host:{ memory } };
for (const imp of WebAssembly.Module.imports(module_)) {
  if (imp.kind === 'function') (imports[imp.module] ||= {})[imp.name] = () => 0;
}
imports.host.math_pow2 = value => 2 ** value;
imports.host.math_log2 = Math.log2;
const a = new WebAssembly.Instance(module_, imports).exports;
const b = new WebAssembly.Instance(module_, imports).exports;
a.init_thread(0,0x400000,0,0,0,0,0);
b.init_thread(1,0x400000,0,0,0,0,0);
function load(e, value) {
  const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value);
  for (let i=0;i<8;i++) e.guest_write8(0x403000+i,bytes[i]);
  e.fld(0x403000);
}
const errors = [];
function check(label, action) {
  try { action(); console.log('PASS '+label); }
  catch (error) { errors.push(label+': '+error.message); console.error('FAIL '+label+': '+error.message); }
}
const av = [1.25,-2.5,3.75,-4.125,5.5,-6.75,7.875,-8.25];
const bv = [101.5,102.75,-103.25,104.5,-105.75,106.125,-107.5,108.75];
for (let i=0;i<8;i++) {
  load(a,av[i]); load(b,bv[i]);
  check('interleaved FLD keeps A physical register '+i,()=>assert.strictEqual(a.st(0),av[i]));
  check('interleaved FLD keeps B physical register '+i,()=>assert.strictEqual(b.st(0),bv[i]));
}
const stack = e => Array.from({length:8},(_,i)=>e.st(i));
let ar = av.slice().reverse(), br = bv.slice().reverse();
check('all eight A registers survive B writes',()=>assert.deepStrictEqual(stack(a),ar));
check('all eight B registers retain their own values',()=>assert.deepStrictEqual(stack(b),br));
a.fstp(0x403100); b.fstp(0x403100); b.fstp(0x403100);
ar=ar.slice(1).concat(ar.slice(0,1));br=br.slice(2).concat(br.slice(0,2));
a.save(0x404000);
check('FNSAVE initializes only saving instance tags',()=>{
  assert.strictEqual(a.tags(),0); assert.notStrictEqual(b.tags(),0); assert.deepStrictEqual(stack(b),br);
});
b.save(0x404100);
a.restore(0x404000);
check('FRSTOR restores A saved physical bank',()=>assert.deepStrictEqual(stack(a),ar));
b.restore(0x404100);
check('FRSTOR of B cannot overwrite restored A',()=>assert.deepStrictEqual(stack(a),ar));
check('FRSTOR restores B saved physical bank',()=>assert.deepStrictEqual(stack(b),br));
assert.strictEqual(a.top(),1); assert.strictEqual(b.top(),2);
function loadInteger(e,value){
 const bytes=Buffer.alloc(8);bytes.writeBigInt64LE(value);
 for(let i=0;i<8;i++)e.guest_write8(0x403000+i,bytes[i]);
 e.fild(0x403000);
}
function storeInteger(e){
 e.fistp(0x403000);return Buffer.from(Array.from({length:8},(_,i)=>e.guest_read8(0x403000+i))).readBigInt64LE();
}
const ai=9007199254740993n,bi=-9007199254740995n;
loadInteger(a,ai);loadInteger(b,bi);
check('interleaved FILD/FISTP preserves A raw integer above2^53',()=>assert.strictEqual(storeInteger(a),ai));
check('interleaved FILD/FISTP preserves B raw integer below-2^53',()=>assert.strictEqual(storeInteger(b),bi));
assert.strictEqual(errors.length,0,errors.join('\n'));
