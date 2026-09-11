#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {VirtualFS}=require('../lib/filesystem');
const {prepare}=require('../lib/stock-font-bootstrap');
const ownership=require('../lib/vfs-entry-ownership');
const fs=require('fs');
const vm=require('vm');
const {BUNDLED_BITMAP_FONTS}=require('../lib/font-substitutions');
const names=['system','mssansserif','fixedsys','courier','terminal'];
const path=name=>`c:\\windows\\fonts\\${name}.fon`;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(size=19){
 const vfs=new VirtualFS(),providers=[],order=[];let active=0,maxActive=0;
 names.forEach((name,index)=>{
  const bytes=Uint8Array.from({length:size},(_,i)=>(i*19+index+1)&255);
  const provider={size,revision:0,refs:0,bytes,calls:0,
   retain(){this.refs++;},release(){this.refs--;},
   async readRange(off,len){
    this.calls++;order.push(index);active++;maxActive=Math.max(active,maxActive);
    try{await Promise.resolve();return bytes.slice(off,off+len);}finally{active--;}
   }};
  providers.push(provider);vfs.setProviderFile(path(name),{provider});
 });
 const pending={handle:123,pos:42};vfs.pendingRead=pending;
 return {vfs,providers,order,pending,maxActive:()=>maxActive};
}
async function clean(f){f.vfs.files.clear();await ownership.drain();assert(f.providers.every(p=>p.refs===0));}
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
 await test('font index order matches bundled mount ABI and browser global works across realm',async()=>{
  assert.deepStrictEqual(BUNDLED_BITMAP_FONTS.map(value=>value.toLowerCase().replace(/\.fon$/,'')),names);
  const browser={};vm.runInNewContext(fs.readFileSync(require.resolve('../lib/stock-font-bootstrap'),'utf8'),browser);
  assert(browser.StockFontBootstrap&&typeof browser.StockFontBootstrap.prepare==='function');
  const f=fixture(),batch=await browser.StockFontBootstrap.prepare(f.vfs);
  assert.strictEqual(batch.count,5);assert.deepStrictEqual(batch.read(0),f.providers[0].bytes);
  batch.release();await clean(f);
 });
 await test('five sequential immutable leases preserve VFS pending and lazy entries',async()=>{
  const f=fixture(131073),batch=await prepare(f.vfs);
  assert(Object.isFrozen(batch));assert.strictEqual(batch.count,5);assert.strictEqual(batch.isCurrent(),true);
  assert.strictEqual(f.maxActive(),1);assert.deepStrictEqual([...new Set(f.order)],[0,1,2,3,4]);
  for(let i=1;i<f.order.length;i++)assert(f.order[i]>=f.order[i-1],'fonts complete sequentially');
  assert.strictEqual(f.vfs.pendingRead,f.pending);assert.strictEqual(f.vfs.handles.size,0);
  for(let i=0;i<5;i++){
   assert.strictEqual(batch.size(i),131073);assert.deepStrictEqual(batch.read(i),f.providers[i].bytes);
   const copy=batch.read(i);copy.fill(0);assert.deepStrictEqual(batch.read(i),f.providers[i].bytes);
   assert(f.vfs.files.get(path(names[i]))._provider);assert.strictEqual(f.providers[i].refs,2);
  }
  for(const i of [-1,5,NaN,Infinity,1.5]){assert.throws(()=>batch.read(i),RangeError);assert.throws(()=>batch.size(i),RangeError);}
  batch.release();batch.release();assert.strictEqual(batch.isCurrent(),false);assert.throws(()=>batch.read(0));
  assert(f.providers.every(p=>p.refs===1));await clean(f);
 });
 await test('all five fonts are required and failure releases earlier leases',async()=>{
  for(const index of [0,2,4]){
   const f=fixture();f.vfs.files.delete(path(names[index]));
   await assert.rejects(prepare(f.vfs));
   f.providers.forEach((p,i)=>assert.strictEqual(p.refs,i===index?0:1));
   assert.strictEqual(f.vfs.pendingRead,f.pending);await clean(f);
  }
 });
 await test('per-font cap rejects oversized media before its IO; maximum aggregate is bounded',async()=>{
  const f=fixture();const entry=f.vfs.files.get(path(names[2]));entry._size=0xF0001;
  await assert.rejects(prepare(f.vfs));assert.strictEqual(f.providers[2].calls,0);
  assert(f.providers.every(p=>p.refs===1));await clean(f);
  const max=fixture(0xF0000),batch=await prepare(max.vfs);
  assert.strictEqual(Array.from({length:batch.count},(_,i)=>batch.size(i)).reduce((a,b)=>a+b,0),5*0xF0000);
  batch.release();await clean(max);
 });
 await test('prior lease revision changing during later read rejects the complete batch',async()=>{
  const f=fixture(),entered=deferred(),gate=deferred(),p=f.providers[2];
  p.readRange=async(off,len)=>{entered.resolve();await gate.promise;return p.bytes.slice(off,off+len);};
  const pending=prepare(f.vfs),rejected=assert.rejects(pending);await entered.promise;
  assert.strictEqual(f.providers[0].refs,2);f.providers[0].revision++;
  gate.resolve();await rejected;assert(f.providers.every(p=>p.refs===1));await clean(f);
 });
 await test('provider fault releases prior and current lease; later fonts never read',async()=>{
  const f=fixture();f.providers[2].readRange=async()=>{throw Error('font medium removed');};
  await assert.rejects(prepare(f.vfs));assert(f.providers.every(p=>p.refs===1));
  assert.strictEqual(f.providers[3].calls,0);assert.strictEqual(f.providers[4].calls,0);await clean(f);
 });
 await test('abort during IO retains provider until settled and releases batch',async()=>{
  const f=fixture(),entered=deferred(),gate=deferred(),p=f.providers[2],controller=new AbortController();
  p.readRange=async(off,len)=>{entered.resolve();await gate.promise;return p.bytes.slice(off,off+len);};
  const pending=prepare(f.vfs,{signal:controller.signal}),rejected=assert.rejects(pending);await entered.promise;
  controller.abort();f.vfs.files.clear();await ownership.drain();assert.strictEqual(p.refs,1,'in-flight lease pins provider');
  gate.resolve();await rejected;await ownership.drain();assert(f.providers.every(p=>p.refs===0));
  assert.strictEqual(f.vfs.pendingRead,f.pending);
 });
 await test('abort before and after prepare invalidates all bytes with idempotent cleanup',async()=>{
  const f=fixture(),before=new AbortController();before.abort();
  await assert.rejects(prepare(f.vfs,{signal:before.signal}));assert(f.providers.every(p=>p.calls===0));
  const controller=new AbortController(),batch=await prepare(f.vfs,{signal:controller.signal});controller.abort();
  assert.strictEqual(batch.isCurrent(),false);assert.throws(()=>batch.read(0));batch.release();batch.release();
  assert(f.providers.every(p=>p.refs===1));await clean(f);
 });
 await test('ready stale font rejects batch reads instead of exposing mixed generation',async()=>{
  const f=fixture(),batch=await prepare(f.vfs);f.providers[4].revision++;
  assert.strictEqual(batch.isCurrent(),false);assert.throws(()=>batch.read(4));
  assert.throws(()=>batch.read(0),'entire batch is stale, not just changed index');
  batch.release();await clean(f);
 });
 console.log(count+' stock-font bootstrap cases passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
