#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const { bootRenderHarness } = require('./render-helper');
const { fixture, checkFixture } = require('./test-volume-native-fixture');

(async () => {
  const rows = checkFixture(fs.readFileSync(fixture, 'utf8')).filter(row => !row.wide);
  const { exports: e, hostCtx } = await bootRenderHarness();
  hostCtx.vfs.driveTypes = new Map([['c',3],['d',5]]);
  hostCtx.vfs.volumeLabels = new Map([['d','REFERENCE']]);
  hostCtx.vfs.volumeSerials = new Map(rows.map(r => [r.drive ? 'd' : 'c', r.serial]));
  const root = e.guest_alloc(16) >>> 0;
  const label = e.guest_alloc(164) >>> 0, name = e.guest_alloc(164) >>> 0;
  const scalar = e.guest_alloc(20) >>> 0;
  const stack = e.guest_alloc(48) >>> 0;
  const fill = (at,n) => {for(let i=0;i<n;i++)e.guest_write8(at+i,0xcc);};
  const bytes = (at,n) => Buffer.from(Array.from({length:n},(_,i)=>e.guest_read8(at+i)));
  let count = 0;
  for (const wide of [false,true]) for (const row of rows) {
    fill(label,164); fill(name,164); fill(scalar,20); fill(stack,48);
    const rootBytes = Buffer.from((row.drive ? 'D' : 'C') + ':\\\0', wide ? 'utf16le' : 'ascii');
    rootBytes.forEach((value,i)=>e.guest_write8(root+i,value));
    const sp = stack + 4;
    e.set_esp(sp); e.test_call_SetLastError(4660); e.set_esp(sp);
    const got = e[wide ? 'test_call_GetVolumeInformationW' : 'test_call_GetVolumeInformationA'](
      root, row.nulls & 1 ? 0 : label + 2, row.which === 0 ? row.cap : 64,
      scalar + 4, scalar + 8, scalar + 12, row.nulls & 2 ? 0 : name + 2,
      row.which === 1 ? row.cap : 64);
    const tag = JSON.stringify({wide,...row});
    assert.strictEqual(got,row.result,tag);
    assert.strictEqual(e.test_call_GetLastError(),row.error,tag);
    assert.strictEqual(e.get_esp() >>> 0,sp,'preserve caller ESP');
    assert.deepStrictEqual([e.guest_read32(scalar+4)>>>0,e.guest_read32(scalar+8),e.guest_read32(scalar+12)],
      [row.serial,row.max,row.flags],tag);
    for(const [at,expectedHex] of [[label,row.label],[name,row.fs]]) {
      const expected = Buffer.alloc(164,0xcc);
      const ansi = Buffer.from(expectedHex,'hex');
      const end = ansi.indexOf(0);
      if(end >= 0) Buffer.from(ansi.subarray(0,end).toString('ascii')+'\0',wide?'utf16le':'ascii').copy(expected,2);
      assert.deepStrictEqual(bytes(at,164),expected,tag);
    }
    assert.strictEqual(e.guest_read32(scalar)>>>0,0xcccccccc);
    assert.strictEqual(e.guest_read32(scalar+16)>>>0,0xcccccccc);
    assert.strictEqual(e.guest_read32(stack)>>>0,0xcccccccc);
    assert.strictEqual(e.guest_read32(sp)>>>0,0xcccccccc);
    assert.strictEqual(e.guest_read32(sp+36)>>>0,0xcccccccc);
    count++;
  }
  console.log(`PASS 42 native ANSI volume observations + 42 explicitly non-native Unicode-extension cases (${count} total)`);
  const page = (base, filler) => {
    assert.strictEqual(e.test_virtual_map_commit(base,4096)>>>0,base);
    assert.strictEqual(e.test_virtual_map_commit(filler,12288)>>>0,filler);
    assert.strictEqual(e.test_virtual_map_commit(base+4096,4096)>>>0,base+4096);
    assert.notStrictEqual((e.guest_to_wasm(base+4095)+1)>>>0,e.guest_to_wasm(base+4096)>>>0,
      'adjacent guest pages have noncontiguous backing');
    return base+4095;
  };
  const sparseLabel = page(0x30000000,0x28000000);
  const sparseName = page(0x31000000,0x28100000);
  const sparseSp = page(0x32000000,0x28200000)-25;
  for(const wide of [false,true]) {
    fill(sparseLabel-2,164); fill(sparseName-2,164); fill(sparseSp-4,48);
    Buffer.from('D:\\\0',wide?'utf16le':'ascii').forEach((v,i)=>e.guest_write8(root+i,v));
    e.set_esp(sparseSp);
    assert.strictEqual(e[wide?'test_call_GetVolumeInformationW':'test_call_GetVolumeInformationA'](
      root,sparseLabel,64,scalar+4,scalar+8,scalar+12,sparseName,64),1);
    assert.strictEqual(e.get_esp()>>>0,sparseSp);
    for(const [at,text] of [[sparseLabel,'REFERENCE'],[sparseName,'CDFS']]) {
      const expected=Buffer.alloc(164,0xcc);
      Buffer.from(text+'\0',wide?'utf16le':'ascii').copy(expected,2);
      assert.deepStrictEqual(bytes(at-2,164),expected,'cross-page strings retain both guards');
    }
  }
  console.log('PASS noncontiguous-page ANSI/Unicode label, filesystem name and argument frame');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
