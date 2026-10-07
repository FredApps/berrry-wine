#!/usr/bin/env node
'use strict';
// Exercise the shipping NE loader, not a JavaScript relocation implementation.
// Optional second argument authenticates and checks the recovered original DLL.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GUEST_BASE } = require('../lib/region-map.generated.js');
function fixture() {
  const b = Buffer.alloc(0xa00), n = 0x80;
  b.write('MZ'); b.writeUInt32LE(n, 0x3c); b.write('NE', n);
  const word = (o, v) => b.writeUInt16LE(v, o);
  word(n + 4, 0x80); word(n + 6, 12); // entry43, movable segment1:01e8
  word(n + 0xe, 2); word(n + 0x14, 0); word(n + 0x16, 1);
  word(n + 0x1c, 2); word(n + 0x22, 0x40); word(n + 0x32, 4);
  word(n + 0x40, 0x40); word(n + 0x42, 0x300); word(n + 0x44, 0x100); word(n + 0x46, 0x300);
  word(n + 0x48, 0x80); word(n + 0x4a, 0x100); word(n + 0x4c, 1); word(n + 0x4e, 0x100);
  b.set([42, 0, 1, 255, 0, 0xcd, 0x3f, 1, 0xe8, 1, 0, 0], n + 0x80);
  const records = [
    [3, 4, 0x10, 255, 43], // original SMACKW16 addend0056 ->023e
    [3, 4, 0x20, 255, 43], // original SMACKW16 addend0074 ->025c
    [3, 0, 0x30, 1, 0x123], // nonadditive two-site chain
    [3, 4, 0x50, 1, 0x30], // offset wraps; selector is replaced
    [5, 4, 0x60, 1, 0x30], // existing additive OFFSET16 unchanged
  ];
  for (const [o,v] of [[0x10,0x56],[0x12,0xbeef],[0x20,0x74],[0x22,0xabcd],[0x30,0x40],[0x40,0xffff],[0x50,0xfff0],[0x52,0x7777],[0x60,0x56]]) word(0x400+o,v);
  word(0x700, records.length);
  records.forEach(([type,flags,site,a,c],i)=>{const o=0x702+8*i;b[o]=type;b[o+1]=flags;word(o+2,site);word(o+4,a);word(o+6,c);});
  return b;
}
async function main() {
  const wasm = process.argv[2] || path.join(__dirname, '../build/wine-assembly.wasm');
  const mod = await WebAssembly.compile(fs.readFileSync(wasm));
  const memory = new WebAssembly.Memory({ initial:8192, maximum:8192, shared:true });
  const imports = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    const group = imports[imp.module] ||= {};
    if (imp.kind === 'memory') group[imp.name] = memory;
    else if (imp.kind === 'function') group[imp.name] = () => 0;
    else throw Error('unexpected import '+imp.kind);
  }
  const { exports:e } = await WebAssembly.instantiate(mod, imports);
  function load(bytes) {
    new Uint8Array(memory.buffer).set(bytes,e.get_staging());
    assert(e.load_ne(bytes.length)>=0, 'actual loader accepted NE');
    return e.win16_seg_base(1)+GUEST_BASE;
  }
  const wa=load(fixture()),dv=new DataView(memory.buffer),word=o=>dv.getUint16(wa+o,true);
  assert.equal(word(0x10),0x23e,'SMACKW16 addend0056 reaches initializer wrapper023e');
  assert.equal(word(0x20),0x25c,'SMACKW16 addend0074 reaches termination wrapper025c');
  for(const o of [0x12,0x22,0x32,0x42,0x52])assert.equal(word(o),15,'selector replaced without addend/carry');
  assert.equal(word(0x30),0x123);assert.equal(word(0x40),0x123,'nonadditive chain preserved');
  assert.equal(word(0x50),0x20,'16-bit offset wrap');assert.equal(word(0x60),0x86,'OFFSET16 preserved');
  console.log('PASS real NE loader: additive far offsets, selector replacement, wrap, nonadditive chain, OFFSET16');
  if(process.argv[3]) {
    const bytes=fs.readFileSync(process.argv[3]);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'0c7e5a7473ac1ca979faeb48cced01b707afd55ff7138ecd867c8085f6e7fcfd','original SMACKW16 identity');
    const base=load(bytes),w=o=>dv.getUint16(base+o,true);
    assert.equal(w(0x276),0x23e,'authentic original #37 call');assert.equal(w(0x27c),0x25c,'authentic original #39 call');
    assert.equal(w(0x278),15);assert.equal(w(0x27e),15);
    assert.deepEqual([...new Uint8Array(memory.buffer,base+0x242,8)],[0x3e,0xbe,0xb2,1,0x3e,0xbf,0xb2,1],'actual wrapper sets SI/DI independently of loader');
    console.log('PASS authentic recovered SMACKW16 call targets and own SI/DI initializer');
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
