#!/usr/bin/env node
'use strict';
const assert = require('assert');
const {compileSrcWasm} = require('./compile-src');
const table = require('../src/api_table.json');
const extra = `
  (export "test_import" (func $import_hint_override_api_id))
  (export "test_is_dx" (func $name_is_static_dx_dll))
  (func (export "test_call") (param $id i32) (param $a i32) (param $b i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;
const module_ = new WebAssembly.Module(compileSrcWasm((file, source) =>
  file === '13-exports.wat' ? source + extra : source));
const memory = new WebAssembly.Memory({initial:8192, maximum:8192, shared:true});
const imports = {host:{memory}};
for (const i of WebAssembly.Module.imports(module_))
  if (i.kind === 'function') (imports[i.module] ||= {})[i.name] = () => 0;
const e = new WebAssembly.Instance(module_, imports).exports;
e.init_thread(0,0x400000,0,0,0,0,0); e.heap_init(0x420000);
const id = name => { const row=table.find(row=>row.name===name); assert(row,name); return row.id; };
const wa = p => e.guest_to_wasm(p)>>>0;
const read = p => new DataView(memory.buffer).getUint32(wa(p),true);
const string = text => {
  const bytes=Buffer.from(text+'\0'), p=e.guest_alloc(bytes.length);
  new Uint8Array(memory.buffer,wa(p),bytes.length).set(bytes); return p;
};
const dll2=string('GLIDE2X.DLL'), dll3=string('glide3x.dll'), dx=string('ddraw.dll');
const call=(name,a=0,b=0)=>e.test_call(id(name),a,b)>>>0;
const h2=call('LoadLibraryA',dll2), h3=call('LoadLibraryA',dll3);
assert(h2&&h3&&h2!==h3,'Glide generations have distinct static module handles');
assert.strictEqual(call('GetModuleHandleA',dll3),h3);
assert.strictEqual(e.test_is_dx(dll2),0); assert.strictEqual(e.test_is_dx(dll3),0);
assert.strictEqual(e.test_is_dx(dx),1,'existing DirectX classification preserved');
for (const [name,arity,legacy] of [
  ['grGlideInit',0,'grGlideInit'], ['grSstWinClose',1,'grSstWinClose'],
  ['grTexDownloadTable',2,'grTexDownloadTable'], ['grLfbWriteRegion',9,'grLfbWriteRegion'],
]) {
  for (const spelling of [name,`_${name}@${arity*4}`]) {
    const p=string(spelling), target=call('GetProcAddress',h3,p);
    assert(target,'dynamic '+spelling);
    assert.strictEqual(read(target+4),id('glide3_'+name),'Glide3 dynamic '+spelling);
    const hint=e.guest_alloc(spelling.length+3);
    new Uint8Array(memory.buffer,wa(hint),spelling.length+3).set(Buffer.concat([Buffer.alloc(2),Buffer.from(spelling+'\0')]));
    assert.strictEqual(e.test_import(dll3,wa(hint)),id('glide3_'+name),'Glide3 static '+spelling);
    assert.strictEqual(e.test_import(dll2,wa(hint)),-1,'Glide2 is not remapped');
  }
  const legacyThunk=call('GetProcAddress',h2,string(name));
  assert.strictEqual(read(legacyThunk+4),id(legacy),'Glide2 dynamic ABI stays unchanged');
}
assert.strictEqual(call('GetProcAddress',h3,string('grUnimplementedExtension')),0);
console.log('PASS Glide DLL-scoped static and dynamic ABI resolution');
