'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {bootRenderHarness}=require('./render-helper');
const apis=require('../src/api_table.json');
const {interfaces}=require('../tools/d3dim-methods');
const methods=['Release','Lock','ProcessVertices','GetVertexBufferDesc'];
const source=fs.readFileSync(path.join(__dirname,'../src/09aa-handlers-d3dim.wat'),'utf8');
for(const method of methods){
  const name=`IDirect3DVertexBuffer7_${method}`;
  assert.strictEqual(apis.find(a=>a.name===name).handler,`IDirect3DVertexBuffer_${method}`);
  assert.strictEqual(interfaces.find(i=>i.prefix==='IDirect3DVertexBuffer7').methods.find(m=>m.name===method).handler,
    `IDirect3DVertexBuffer_${method}`,'generator spec matches dispatch alias');
  assert(!source.includes(`(func $handle_${name} `));
}
const extraWat=String.raw`
  (func (export "vb_create") (param $version i32) (param $desc i32) (param $out i32)
    (call $d3dim_create_vb (local.get $desc) (local.get $out)
      (select (global.get $DX_VTBL_D3DVB7) (global.get $DX_VTBL_D3DVB) (local.get $version))))
  (func (export "vb_entry") (param $obj i32) (result i32) (call $dx_from_this (local.get $obj)))
  (func (export "vb_call") (param $id i32) (param $obj i32) (param $a i32)
      (param $b i32) (param $c i32) (param $stack i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (local.get $id) (local.get $obj) (local.get $a)
      (local.get $b) (local.get $c) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;
(async()=>{
  const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat});
  e.init_dx_com_thunks();
  const v=new DataView(memory.buffer), stack=e.guest_alloc(64),desc=e.guest_alloc(32),out=e.guest_alloc(40);
  [16,0,2,4].forEach((x,i)=>e.guest_write32(desc+i*4,x));
  for(const [version,prefix] of [[0,'IDirect3DVertexBuffer'],[1,'IDirect3DVertexBuffer7']]){
    e.vb_create(version,desc,out);
    const obj=e.guest_read32(out), entry=e.vb_entry(obj);
    assert(obj);assert.strictEqual(v.getUint32(entry,true),22);
    const call=(method,pop,a=0,b=0,c=0)=>{
      e.guest_write32(stack+pop,0xdeadbeef);
      const r=e.vb_call(apis.find(x=>x.name===`${prefix}_${method}`).id,obj,a,b,c,stack)>>>0;
      assert.strictEqual(e.get_esp()>>>0,stack+pop);
      assert.strictEqual(e.guest_read32(stack+pop)>>>0,0xdeadbeef);
      return r;
    };
    assert.strictEqual(call('Lock',20,0,out,out+4),0);
    const backing=e.guest_read32(out);assert(backing);
    assert.strictEqual(e.guest_read32(out+4),48);
    e.guest_write32(backing,0x12345678);
    e.guest_write32(out,16); e.guest_write32(out+16,0xcafebabe);
    assert.strictEqual(call('GetVertexBufferDesc',12,out),0);
    assert.deepStrictEqual([0,4,8,12].map(i=>e.guest_read32(out+i)),[16,0,2,4]);
    assert.strictEqual(e.guest_read32(out+16)>>>0,0xcafebabe);
    assert.strictEqual(call('AddRef',8),2);
    assert.strictEqual(call('Release',8),1);
    assert.strictEqual(v.getUint32(entry,true),22);
    assert.strictEqual(e.guest_read32(backing)>>>0,0x12345678);
    assert.strictEqual(call('Release',8),0);
    assert.strictEqual(v.getUint32(entry,true),0);
  }
  console.log('PASS D3DIM VB/VB7 alias dispatch, lock/descriptor outputs, lifetime and stack guards');
})().catch(error=>{console.error(error);process.exitCode=1;});
