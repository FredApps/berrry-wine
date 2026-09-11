'use strict';
const assert = require('assert');
const {bootRenderHarness} = require('./render-helper');
(async () => {
  const methods = ['SetViewport', 'GetViewport', 'SetScissorRect', 'GetScissorRect', 'BeginStateBlock', 'EndStateBlock'];
  const {exports:e} = await bootRenderHarness({fonts:'none', extraWat:`
    (func (export "device") (param $out i32) (result i32)
      (local $d i32) (local $rt i32)
      (call $d3dim_create_device (i32.const 0) (i32.const 0) (local.get $out) (global.get $DX_VTBL_D3DDEV9))
      (local.set $d (call $gl32 (local.get $out)))
      (store.field DxObject type (call $dx_from_this (local.get $d)) (i32.const 20))
      (store.field DxObject misc1 (call $dx_from_this (local.get $d)) (call $d3d9_program_alloc))
      (local.set $rt (call $d3ddev_rt_entry (local.get $d)))
      (store.field DxObject width (local.get $rt) (i32.const 320))
      (store.field DxObject height (local.get $rt) (i32.const 240))
      (local.get $d))
    ${[...methods.map(n=>['IDirect3DDevice9',n]),
      ...['Capture','Apply','Release'].map(n=>['IDirect3DStateBlock9',n])].map(([type,n])=>`
      (func (export "${n}") (param $a i32) (param $b i32) (result i32)
        (global.set $esp (i32.const 0x074ff000))
        (call $handle_${type}_${n} (local.get $a) (local.get $b) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0)) (global.get $eax))`).join('\n')}
  `});
  e.init_dx_com_thunks();
  const out=0x00409000, input=out+64, result=out+128;
  const d=e.device(out), invalid=0x8876086c;
  const read=p=>e.guest_read32(p)>>>0;
  const write=(p,values)=>values.forEach((v,i)=>e.guest_write32(p+i*4,v));
  const get=()=>{assert.strictEqual(e.GetViewport(d,result),0);return Array.from({length:6},(_,i)=>read(result+i*4));};
  const full=[0,0,320,240,0,0x3f800000], a=[4,6,100,80,0x3e800000,0x3f400000];
  const b=[10,20,200,180,0,0x3f800000];
  assert.deepStrictEqual(get(),full);
  assert.strictEqual(e.BeginStateBlock(d),0);
  write(input,a);assert.strictEqual(e.SetViewport(d,input),0);
  assert.deepStrictEqual(get(),full,'recording does not alter live viewport');
  write(input,b);assert.strictEqual(e.SetViewport(d,input),0);
  for (const values of [[0,0,0,2,0,0x3f800000],[319,0,2,2,0,0x3f800000],
    [0,0,2,2,0x7fc00000,0x3f800000],[0,0,2,2,0x3f800000,0]]) {
    write(input,values);assert.strictEqual(e.SetViewport(d,input)>>>0,invalid);
  }
  for (const p of [0,0xfffffff8,0x80000000]) {
    assert.strictEqual(e.SetViewport(d,p)>>>0,invalid);
    assert.strictEqual(e.GetViewport(d,p)>>>0,invalid);
  }
  assert.strictEqual(e.EndStateBlock(d,out),0);const block=read(out);
  write(input,full);assert.strictEqual(e.Apply(block),0);
  assert.deepStrictEqual(get(),b,'last valid recorded value survives caller-memory reuse');
  write(input,a);assert.strictEqual(e.SetViewport(d,input),0);
  assert.strictEqual(e.Capture(block),0);
  write(input,full);assert.strictEqual(e.SetViewport(d,input),0);
  assert.strictEqual(e.Apply(block),0);assert.deepStrictEqual(get(),a);
  assert.strictEqual(e.BeginStateBlock(d),0);
  assert.strictEqual(e.Apply(block)>>>0,invalid);
  assert.strictEqual(e.Capture(block)>>>0,invalid);
  assert.strictEqual(e.EndStateBlock(d,out),0);const empty=read(out);
  write(input,b);assert.strictEqual(e.SetViewport(d,input),0);
  assert.strictEqual(e.Apply(empty),0);assert.deepStrictEqual(get(),b,'unrecorded viewport stays live');
  assert.strictEqual(e.Release(empty),0);assert.strictEqual(e.Release(block),0);
  const scissor=()=>{assert.strictEqual(e.GetScissorRect(d,result),0);return Array.from({length:4},(_,i)=>read(result+i*4));};
  assert.deepStrictEqual(scissor(),[0,0,320,240],'viewport changes do not redefine the default scissor');
  assert.strictEqual(e.BeginStateBlock(d),0);
  write(input,[2,3,100,120]);assert.strictEqual(e.SetScissorRect(d,input),0);
  write(input,[4,5,90,110]);assert.strictEqual(e.SetScissorRect(d,input),0);
  assert.deepStrictEqual(scissor(),[0,0,320,240],'recording leaves live scissor unchanged');
  for(const values of [[-1,0,1,1],[0,-1,1,1],[5,0,4,1],[0,5,1,4],[0,0,321,240],[0,0,320,241]]){
    write(input,values);assert.strictEqual(e.SetScissorRect(d,input)>>>0,invalid);
  }
  for(const p of [0,0xfffffff8,0x80000000]){
    assert.strictEqual(e.SetScissorRect(d,p)>>>0,invalid);
    assert.strictEqual(e.GetScissorRect(d,p)>>>0,invalid);
  }
  assert.strictEqual(e.EndStateBlock(d,out),0);const scissors=read(out);
  write(input,[0,0,0,0]);assert.strictEqual(e.Apply(scissors),0);
  assert.deepStrictEqual(scissor(),[4,5,90,110],'last valid copied scissor wins');
  write(input,[7,9,7,9]);assert.strictEqual(e.SetScissorRect(d,input),0);
  assert.strictEqual(e.Capture(scissors),0);
  write(input,[0,0,320,240]);assert.strictEqual(e.SetScissorRect(d,input),0);
  assert.strictEqual(e.Apply(scissors),0);
  assert.deepStrictEqual(scissor(),[7,9,7,9],'empty scissor survives Capture/Apply');
  assert.strictEqual(e.Release(scissors),0);
  console.log('PASS D3D9 viewport/scissor state blocks: recording, last valid write, immutable bytes, Capture/Apply, live getters and bounds');
})().catch(error=>{console.error(error);process.exitCode=1;});
