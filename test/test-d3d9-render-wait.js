#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bootRenderHarness} = require('./render-helper');
const drawId = require('../src/api_table.json').find(a => a.name === 'IDirect3DDevice9_DrawPrimitiveUP').id;
const apiId = name => require('../src/api_table.json').find(a => a.name === name).id;
const bytes32 = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
(async () => {
  let submissions = 0, polls = 0, ready = false, completion = 1, pendingOpcode = 0x30001;
  const token = -19;
  const {exports:e, memory} = await bootRenderHarness({fonts:'none',
    extraHostOverrides:{gpu_gl_call(op, address, aux) {
      if (op === pendingOpcode) { submissions++; return token; }
      if (op === 0x30007) {
        assert.strictEqual(address, 0); assert.strictEqual(aux, token);
        polls++; return ready ? completion : token;
      }
      return 1;
    }}, extraWat:`
    (func (export "draw_thunk") (result i32)
      (call $gl32 (call $init_com_vtable (i32.const ${drawId}) (i32.const 1))))
    (func (export "api_thunk") (param $id i32) (result i32)
      (call $gl32 (call $init_com_vtable (local.get $id) (i32.const 1))))
    (func (export "target_bits") (param $d i32) (result i32)
      (load.field DxObject misc1 (call $d3ddev_rt_entry (local.get $d))))
    (func (export "device_refs") (param $d i32) (result i32)
      (load.field DxObject refcount (call $dx_from_this (local.get $d))))
    (func (export "make_query") (param $d i32) (param $out i32) (result i32)
      (call $d3d9_query_create (local.get $d) (i32.const 8) (local.get $out)) (global.get $eax))
    (func (export "start_inline") (param $code i32)
      (global.set $esp (i32.const 0x07000000))
      (call $gs32 (global.get $esp) (i32.const 0))
      (global.set $eip (local.get $code)))
    (func (export "create_device") (param $pp i32) (param $out i32) (result i32)
      (global.set $esp (i32.const 0x07000000))
      (call $gs32 (i32.add (global.get $esp) (i32.const 24)) (local.get $pp))
      (call $gs32 (i32.add (global.get $esp) (i32.const 28)) (local.get $out))
      (call $handle_IDirect3D9_CreateDevice (i32.const 0) (i32.const 0) (i32.const 1)
        (i32.const 1) (i32.const 0) (i32.const 0)) (global.get $eax))
    (func (export "make_buffer") (param $d i32) (param $out i32) (result i32)
      (call $d3d9_buffer_create (local.get $d) (i32.const 64) (i32.const 0)
        (i32.const 0) (i32.const 1) (local.get $out) (i32.const 6)) (global.get $eax))
    (func (export "bind_buffer") (param $d i32) (param $b i32)
      (call $d3d9_buffer_bind (local.get $d) (local.get $b) (i32.const 6) (i32.const 0) (i32.const 16)))
    (func (export "make_indices") (param $d i32) (param $out i32) (result i32)
      (call $d3d9_buffer_create (local.get $d) (i32.const 6) (i32.const 0)
        (i32.const 101) (i32.const 1) (local.get $out) (i32.const 7)) (global.get $eax))
    (func (export "bind_indices") (param $d i32) (param $b i32)
      (call $d3d9_buffer_bind (local.get $d) (local.get $b) (i32.const 7) (i32.const 0) (i32.const 0)))
    (func (export "bound_indices") (param $d i32) (result i32)
      (call $gl32 (i32.add (call $d3d9_program_state (local.get $d)) (i32.const 1732))))
    (func (export "bound_buffer") (param $d i32) (result i32)
      (call $gl32 (i32.add (call $d3d9_program_state (local.get $d)) (i32.const 1720))))
  `});
  const pe = fs.readFileSync(path.join(__dirname, 'binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(pe, e.get_staging());
  assert.ok(e.load_pe(pe.length)); e.init_dx_com_thunks();
  const alloc = n => e.guest_alloc(n) >>> 0;
  const read = p => e.guest_read32(p) >>> 0;
  const out = alloc(4), pp = alloc(64), vertices = alloc(48), marker = alloc(4);
  new Uint8Array(memory.buffer, e.guest_to_wasm(pp), 64).fill(0);
  [8,8,21,1,0,0,1,1,1].forEach((v,i) => e.guest_write32(pp+i*4,v));
  assert.strictEqual(e.create_device(pp,out),0);
  const device = read(out);
  assert.strictEqual(e.make_buffer(device,out),0);
  const buffer = read(out), thunk = e.draw_thunk() >>> 0;
  for (const result of [1,-1]) {
    ready = false; completion = result;
    e.bind_buffer(device,buffer); e.guest_write32(marker,0xdeadbeef);
    const caller = alloc(64);
    new Uint8Array(memory.buffer).set([
      0x68,...bytes32(16),0x68,...bytes32(vertices),0x6a,1,0x6a,4,
      0x68,...bytes32(device),0xb8,...bytes32(thunk),0xff,0xd0,
      0xa3,...bytes32(marker),0xc3,
    ],e.guest_to_wasm(caller));
    const before = submissions, beforePoll = polls;
    e.clear_yield(); e.start_inline(caller); e.run(1000);
    assert.strictEqual(e.get_yield_reason(),16);
    assert.strictEqual(e.get_d3d_render_token(),token);
    assert.strictEqual(submissions,before+1);
    assert.strictEqual(read(marker),0xdeadbeef,'caller must remain parked');
    assert.strictEqual(e.bound_buffer(device)>>>0,buffer,'UP unbind is deferred');
    const parkedESP = e.get_esp();
    e.run(1000);
    assert.strictEqual(polls,beforePoll,'run without scheduler readiness stays parked');
    e.clear_yield(); e.run(1000);
    assert.strictEqual(polls,beforePoll+1);
    assert.strictEqual(e.get_esp(),parkedESP,'pending retry preserves stdcall frame');
    assert.strictEqual(e.bound_buffer(device)>>>0,buffer);
    ready = true; e.clear_yield();
    for (let i=0;i<20 && e.get_eip();i++) e.run(1000);
    assert.strictEqual(e.get_eip(),0);
    assert.strictEqual(e.get_d3d_render_token(),0);
    assert.strictEqual(submissions,before+1,'retry must not enqueue another draw');
    assert.strictEqual(read(marker),result===1?0:0x8876086c);
    assert.strictEqual(e.bound_buffer(device),0,'UP stream unbound only at completion');
    assert.strictEqual(e.get_esp()>>>0,0x07000004,'CALL/RETry/RET stack balanced');
  }
  // Exercise distinct handler epilogues: Present/Clear pop before parking,
  // whereas Query/Release defer their pop. All must preserve a real CALL frame.
  function queuedCall(name,args,op,result,expected,whilePending=()=>{},after=()=>{}) {
    pendingOpcode=op; completion=result; ready=false;
    e.guest_write32(marker,0xdeadbeef);
    const address=alloc(128), target=e.api_thunk(apiId(name))>>>0;
    new Uint8Array(memory.buffer).set([
      ...args.slice().reverse().flatMap(n=>[0x68,...bytes32(n)]),
      0xb8,...bytes32(target),0xff,0xd0,0xa3,...bytes32(marker),0xc3,
    ],e.guest_to_wasm(address));
    const before=submissions, beforePoll=polls;
    e.clear_yield(); e.start_inline(address); e.run(1000);
    assert.strictEqual(e.get_yield_reason(),16,name);
    assert.strictEqual(submissions,before+1,name);
    assert.strictEqual(read(marker),0xdeadbeef,name);
    const savedESP=e.get_esp(); whilePending();
    e.run(1000); assert.strictEqual(polls,beforePoll,name);
    e.clear_yield(); e.run(1000);
    assert.strictEqual(e.get_esp(),savedESP,name);
    assert.strictEqual(polls,beforePoll+1,name); whilePending();
    ready=true; e.clear_yield();
    for(let i=0;i<20&&e.get_eip();i++)e.run(1000);
    assert.strictEqual(e.get_eip(),0,name);
    assert.strictEqual(e.get_d3d_render_token(),0,name);
    assert.strictEqual(read(marker),expected>>>0,name);
    assert.strictEqual(submissions,before+1,`${name} resubmitted`);
    assert.strictEqual(e.get_esp()>>>0,0x07000004,name); after();
  }
  assert.strictEqual(e.make_indices(device,out),0); const indices=read(out);
  for(const result of [1,-1]) {
    const bothBound=()=>{
      assert.strictEqual(e.bound_buffer(device)>>>0,buffer);
      assert.strictEqual(e.bound_indices(device)>>>0,indices);
    };
    e.bind_buffer(device,buffer); e.bind_indices(device,indices);
    queuedCall('IDirect3DDevice9_DrawPrimitive',[device,4,0,1],0x30001,result,
      result===1?0:0x8876086c,bothBound,bothBound);
    queuedCall('IDirect3DDevice9_DrawIndexedPrimitive',[device,4,0,0,3,0,1],0x30001,result,
      result===1?0:0x8876086c,bothBound,bothBound);
    queuedCall('IDirect3DDevice9_DrawIndexedPrimitiveUP',[device,4,0,3,1,indices+64,101,vertices,16],
      0x30001,result,result===1?0:0x8876086c,bothBound,()=>{
        assert.strictEqual(e.bound_buffer(device),0);
        assert.strictEqual(e.bound_indices(device),0);
      });
    queuedCall('IDirect3DDevice9_Present',[device,0,0,0,0],0x30002,result,
      result===1?0:0x8876086c);
    const pixels=new Uint32Array(memory.buffer,e.target_bits(device)>>>0,64);
    pixels.fill(0xff123456);
    queuedCall('IDirect3DDevice9_Clear',[device,0,0,1,0xffabcdef,0x3f800000,0],
      0x30003,result,result===1?0:0x8876086c,
      ()=>assert.ok(pixels.every(p=>p===0xff123456),'no early canonical clear'),
      // This protocol-only host owns the render target but does not render.
      // Clear completion must not invoke the legacy whole-target fill: actual
      // backend pixels are published at Present and tested by worker/COM suites.
      ()=>assert.ok(pixels.every(p=>p===0xff123456),'Clear completion leaves canonical publication to the backend'));
  }
  assert.strictEqual(e.make_query(device,out),0); const query=read(out);
  for(const result of [1,-1]) {
    e.guest_write32(query+28,0x12345678);
    queuedCall('IDirect3DQuery9_Issue',[query,1],0x30006,result,
      result===1?0:0x88760868,
      ()=>assert.strictEqual(read(query+28),0x12345678,'query result not published early'),
      ()=>assert.strictEqual(read(query+28),result===1?0:0x88760868));
  }
  assert.strictEqual(e.create_device(pp,out),0); const retiring=read(out);
  const bits=e.target_bits(retiring)>>>0;
  new Uint32Array(memory.buffer,bits,64).fill(0xff13579b);
  for(const result of [-1,1]) {
    queuedCall('IDirect3DDevice9_Release',[retiring],0x30004,result,result===1?0:1,
      ()=>{
        assert.strictEqual(e.device_refs(retiring),1,'pending release retains native owner');
        assert.strictEqual(e.target_bits(retiring)>>>0,bits);
        assert.strictEqual(new Uint32Array(memory.buffer,bits,1)[0],0xff13579b);
      });
    if(result===-1)assert.strictEqual(e.device_refs(retiring),1,'failed handoff retains owner');
  }
  console.log('PASS D3D9 x86 queued draw/Present/Clear/query/Release retry ABI, errors and deferred effects');
})().catch(error => { console.error(error); process.exitCode=1; });
