'use strict';
const assert=require('assert'), fs=require('fs'), path=require('path');
const {bootRenderHarness}=require('./render-helper');
const apis=require('../src/api_table.json');
const aliases={
  IDirect3DDevice_EnumTextureFormats:'IDirect3DDevice2_EnumTextureFormats',
  IDirect3DDevice7_EnumTextureFormats:'IDirect3DDevice3_EnumTextureFormats',
  IDirect3D7_EnumZBufferFormats:'IDirect3D3_EnumZBufferFormats',
};
const source=fs.readFileSync(path.join(__dirname,'../src/09aa-handlers-d3dim.wat'),'utf8');
for(const [name,handler] of Object.entries(aliases)) {
  assert.strictEqual(apis.find(a=>a.name===name).handler,handler);
  assert(!source.includes('(func $handle_'+name+' '),'no duplicate runtime wrapper');
}
const extraWat=String.raw`
  (func (export "enum_begin") (param $id i32) (param $z i32)
      (param $cb i32) (param $ctx i32) (param $stack i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (local.get $id) (i32.const 0)
      (select (i32.const 0) (local.get $cb) (local.get $z))
      (select (local.get $cb) (local.get $ctx) (local.get $z))
      (select (local.get $ctx) (i32.const 0) (local.get $z))
      (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "enum_return") (param $z i32) (param $result i32) (result i32)
    ;; Simulate callback RET 8: return address plus its two arguments.
    (i32.store offset=16 (global.get $reg_base)
      (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)))
    (i32.store (global.get $reg_base) (local.get $result))
    (if (local.get $z) (then (call $d3d_enum_zbuf_continue))
      (else (call $d3d_enum_tex_continue)))
    (i32.load (global.get $reg_base)))
`;
(async()=>{
  const {exports:e}=await bootRenderHarness({fonts:'none',extraWat});
  e.init_dx_com_thunks();
  const stack=e.guest_alloc(128), callback=0x12345678, caller=0x10203040, context=0x410000;
  const cases=[
    ['IDirect3DDevice_EnumTextureFormats',0,108],
    ['IDirect3DDevice2_EnumTextureFormats',0,108],
    ['IDirect3DDevice3_EnumTextureFormats',0,32],
    ['IDirect3DDevice7_EnumTextureFormats',0,32],
    ['IDirect3D3_EnumZBufferFormats',1,32],
    ['IDirect3D7_EnumZBufferFormats',1,32],
  ];
  const expected=[[0x40,16,0xf800,0x7e0,0x1f,0], [0x41,16,0xf00,0xf0,0xf,0xf000],
    [0x41,16,0x7c00,0x3e0,0x1f,0x8000], [0x40,32,0xff0000,0xff00,0xff,0]];
  for(const [name,z,size] of cases) {
    const id=apis.find(a=>a.name===name).id, pop=z?20:16;
    for(const cancel of [false,true]) {
      e.guest_write32(stack,caller);e.guest_write32(stack+pop,0xdeadbeef);
      e.enum_begin(id,z,callback,context,stack);
      const count=z||cancel?1:4;
      for(let i=0;i<count;i++) {
        assert.strictEqual(e.get_eip()>>>0,callback,name);
        const sp=e.get_esp()>>>0;
        assert.strictEqual(sp,stack+pop-16);
        assert.strictEqual(e.guest_read32(sp+8),context);
        assert.strictEqual(e.guest_read32(sp+12),caller);
        const desc=e.guest_read32(sp+4), pf=desc+(size===108?72:0);
        assert.strictEqual(e.guest_read32(desc),size,name+' callback structure');
        assert.strictEqual(e.guest_read32(pf),32);
        if(z) {
          assert.strictEqual(e.guest_read32(pf+4),0x400);
          assert.strictEqual(e.guest_read32(pf+12),16);
          assert.strictEqual(e.guest_read32(pf+16),0xffff);
        } else {
          assert.deepStrictEqual([4,12,16,20,24,28].map(n=>e.guest_read32(pf+n)>>>0),expected[i]);
        }
        const result=e.enum_return(z,cancel?0:1);
        if(i===count-1)assert.strictEqual(result,0);
      }
      assert.strictEqual(e.get_eip()>>>0,caller);
      assert.strictEqual(e.get_esp()>>>0,stack+pop);
      assert.strictEqual(e.guest_read32(stack+pop)>>>0,0xdeadbeef);
    }
    // Preserve the current null-callback behavior, without claiming it is
    // native conformance (this commit is a dispatch equivalence change).
    e.guest_write32(stack+pop,0xdeadbeef);
    assert.strictEqual(e.enum_begin(id,z,0,context,stack),0);
    assert.strictEqual(e.get_esp()>>>0,stack+pop);
    assert.strictEqual(e.guest_read32(stack+pop)>>>0,0xdeadbeef);
  }
  console.log('PASS six D3D enumeration front doors: distinct callback formats, all formats, cancellation, continuation and ABI');
})().catch(error=>{console.error(error);process.exitCode=1;});
