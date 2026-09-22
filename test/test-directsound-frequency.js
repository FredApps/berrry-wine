'use strict';
const assert = require('assert');
const {bootRenderHarness} = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
  (func (export "ds_call") (param $id i32) (param $a i32) (param $b i32)
      (param $c i32) (param $d i32) (param $stack i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b)
      (local.get $c) (local.get $d) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;
(async () => {
  const events = []; let nextVoice = 0;
  const {exports:e} = await bootRenderHarness({fonts:'none', extraWat, extraHostOverrides:{
    voice_open: (rate, channels, bits) => {events.push(['open', ++nextVoice, rate, channels, bits]); return nextVoice;},
    voice_set_freq: (id, hz) => events.push(['freq', id, hz]),
    voice_set_volume_db: () => {}, voice_set_pan: () => {},
    voice_play_ring: id => {events.push(['play', id]); return 0;},
    voice_stop: () => 0, voice_close: () => 0, voice_get_pos: () => 0,
  }});
  e.init_dx_com_thunks();
  const stack=e.guest_alloc(64), out=e.guest_alloc(32), desc=e.guest_alloc(20), fmt=e.guest_alloc(20);
  const call=(name,args,pop)=>{
    e.guest_write32(stack+pop,0xdeadbeef);
    const r=e.ds_call(apis.find(a=>a.name===name).id,...Array.from({length:4},(_,i)=>args[i]||0),stack)>>>0;
    assert.strictEqual(e.get_esp()>>>0,stack+pop,name);
    assert.strictEqual(e.guest_read32(stack+pop)>>>0,0xdeadbeef); return r;
  };
  const method=(name,obj,a=0,b=0,c=0,pop=12)=>call('IDirectSoundBuffer_'+name,[obj,a,b,c],pop);
  assert.strictEqual(call('DirectSoundCreate',[0,out,0],16),0);
  const root=e.guest_read32(out);
  [0x00010001,22050,44100,0x00100002,0].forEach((v,i)=>e.guest_write32(fmt+4*i,v));
  const create=(caps)=>{
    [20,caps,caps&1?0:64,0,caps&1?0:fmt].forEach((v,i)=>e.guest_write32(desc+4*i,v));
    assert.strictEqual(call('IDirectSound_CreateSoundBuffer',[root,desc,out],20),0);
    return e.guest_read32(out);
  };
  const get=(obj,hz,target=out)=>{
    e.guest_write32(target,0x12345678); e.guest_write8(target+4,0xa5);
    assert.strictEqual(method('GetFrequency',obj,target),0);
    assert.strictEqual(e.guest_read32(target),hz); assert.strictEqual(e.guest_read8(target+4),0xa5);
  };
  const original=create(0x20);
  get(original,22050);
  assert.strictEqual(method('SetFrequency',original,11025),0); get(original,11025);
  assert.deepStrictEqual(events,[],'no premature voice allocation');
  assert.strictEqual(method('GetFormat',original,out,18,0,20),0);
  assert.strictEqual(e.guest_read32(out+4),22050,'format rate is not playback rate');
  assert.strictEqual(call('IDirectSound_DuplicateSoundBuffer',[root,original,out],16),0);
  const duplicate=e.guest_read32(out); get(duplicate,11025);
  assert.strictEqual(method('SetFrequency',duplicate,44100),0); get(original,11025);
  for(const [obj,hz] of [[original,11025],[duplicate,44100]]) {
    assert.strictEqual(method('Play',obj,0,0,0,20),0);
    assert.deepStrictEqual(events.splice(0),[['open',nextVoice,22050,1,16],['freq',nextVoice,hz],['play',nextVoice]]);
  }
  for(const hz of [100,100000,0]) {
    assert.strictEqual(method('SetFrequency',original,hz),0);
    get(original,hz||22050);
    assert.deepStrictEqual(events.splice(0),[['freq',1,hz]]);
  }
  for(const hz of [1,99,100001,-1,0x80000000]) {
    assert.strictEqual(method('SetFrequency',original,hz),0x80070057);
    get(original,22050); assert.deepStrictEqual(events,[]);
  }
  const base=0x30000000;
  for(const p of [base,base+0x8000,base+4096]) assert.strictEqual(e.test_virtual_map_commit(p,4096)>>>0,p);
  assert.notStrictEqual(e.guest_to_wasm(base)+4096,e.guest_to_wasm(base+4096));
  get(original,22050,base+4094);
  const noControl=create(0), primary=create(1);
  for(const obj of [noControl,primary]) {
    e.guest_write32(out,0x12345678);
    assert.strictEqual(method('SetFrequency',obj,22050),0x8878001e);
    assert.strictEqual(method('GetFrequency',obj,out),0x8878001e);
    assert.strictEqual(e.guest_read32(out),0x12345678);
  }
  assert.strictEqual(method('GetFrequency',original,0),0x80070057);
  assert.strictEqual(method('SetFrequency',root,22050),0x80070057);
  assert.strictEqual(method('Stop',original,0,0,0,8),0); get(original,22050);
  assert.strictEqual(method('Play',original,0,0,0,20),0);
  assert.deepStrictEqual(events.splice(0),[['play',1]]);
  for(const obj of [original,duplicate,noControl,primary]) assert.strictEqual(method('Release',obj,0,0,0,8),0);
  get(create(0x20),22050);
  console.log('PASS DirectSound frequency: retained playback rate, immutable format, lazy voices, duplicates, limits, sparse output and ABI');
})().catch(error=>{console.error(error);process.exitCode=1;});
