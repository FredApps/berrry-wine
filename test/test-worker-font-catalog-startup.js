'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const { GuestThreadHost } = require('../lib/guest-thread-host');
const { fontMounts } = require('../lib/font-substitutions');
const RegionMap = require('../lib/region-map.generated');
const { Worker } = require('worker_threads');
const ROOT = path.resolve(__dirname,'..');

(async () => {
  const binary = compileSrcWasm((file,source) => file === '13-exports.wat' ? source + `
    (func (export "catalog_startup_noop") (result i32) (i32.const 7))` : source);
  const module_ = await WebAssembly.compile(binary);
  const sigs = require('../lib/host-import-sigs.generated.json').sigs;
  const exe = new Uint8Array(fs.readFileSync(path.join(__dirname,'binaries/notepad.exe')));
  const mounted = fontMounts(require('../fonts/substitutions.json')).find(f => f.vfsPath.toLowerCase().endsWith('arial.ttf'));
  assert(mounted);
  const fontBytes = new Uint8Array(fs.readFileSync(path.join(ROOT,'fonts',mounted.file)));
  const entries = [{path:'c:\\windows\\fonts\\worker-fixture.ttf',bytes:fontBytes}];
  async function withWorker(fn) {
    const memory = new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
    const ctx = {getMemory:()=>memory.buffer, resourceJson:{menus:{},dialogs:{},strings:{},bitmaps:{}},onExit(){}};
    const imports=createHostImports(ctx); imports.host.memory=memory;
    const shadow=new WebAssembly.Instance(module_,imports).exports; ctx.exports=shadow;
    const host=new GuestThreadHost({memory,module:module_,sigs,hostImports:imports.host,
      workerUrl:path.join(ROOT,'lib/guest-worker.js'),clockIntervalMs:0});
    try { await host.start(); await fn({host,memory,shadow}); }
    finally { await host.stop(); }
  }
  async function open(host) {
    assert.strictEqual(await host.getFontCatalogStartupState(),'NEW');
    assert(await host.loadPe(exe,'notepad.exe'));
    assert.strictEqual(await host.getFontCatalogStartupState(),'OPEN');
    return host.getFontCatalogExclusions();
  }
  for (const populated of [true,false]) await withWorker(async ({host,shadow}) => {
    const policy=await open(host);
    const result=await host.installFontCatalog(populated?entries:[],policy);
    assert.strictEqual(result.count,populated?1:0); assert(result.generation>0);
    assert.strictEqual(shadow.font_catalog_ready(),0,'idle shadow never publishes instance-local catalog');
    const state=await host.readExports(['font_catalog_ready','font_catalog_generation']);
    assert.strictEqual(state.font_catalog_ready,1);
    assert.strictEqual(state.font_catalog_generation,result.generation);
  });
  console.log('PASS real Worker post-load populated and empty publication affect executing instance only');

  await withWorker(async ({host,shadow}) => {
    const policy=await open(host);
    for (const bad of [null,Array(33).fill(entries[0]),[{path:entries[0].path,bytes:new Uint8Array()}],
      [{path:entries[0].path,bytes:new Uint8Array(4*1024*1024+1)}],
      [{path:'c:\\windows\\fonts\\caf\u00e9.ttf',bytes:fontBytes}],
      [{path:entries[0].path,bytes:'not bytes'}]]) {
      const seq=host.link._seq;
      await assert.rejects(()=>host.installFontCatalog(bad,policy));
      assert.strictEqual(host.link._seq,seq,'host validates shape before messaging');
      const reply=await host.link._ask({t:'installFontCatalog',entries:bad,expectedExcludedPaths:policy});
      assert(reply.error,'Worker independently rejects invalid payload');
    }
    assert.strictEqual(shadow.font_catalog_ready(),0);
    const state=await host.readExports(['font_catalog_ready']); assert.strictEqual(state.font_catalog_ready,0);
    await assert.rejects(()=>host.installFontCatalog([{path:entries[0].path,bytes:new Uint8Array(128)}],policy));
    assert.strictEqual((await host.readExports(['font_catalog_ready'])).font_catalog_ready,0,'native failure aborts without publication');
    assert.strictEqual((await host.installFontCatalog(entries,policy)).count,1,'validation failure does not poison a subsequent healthy startup transaction');
  });
  console.log('PASS host and Worker independently reject malformed catalogs before publication');

  await withWorker(async ({host,memory}) => {
    const policy=await open(host), bytes=new Uint8Array(memory.buffer);
    const at=RegionMap.BASE.TT_SUBST_ALIAS_TABLE;
    let field=at; while(bytes[field]) field++; field++;
    const saved=bytes[field]; bytes[field]=saved===90?89:90;
    try { await assert.rejects(()=>host.installFontCatalog(entries,policy),/policy|exclusion|changed/i); }
    finally { bytes[field]=saved; }
    assert.strictEqual((await host.readExports(['font_catalog_ready'])).font_catalog_ready,0);
  });
  console.log('PASS changed executing-instance exclusion policy rejects publication');

  for (const route of ['generic','readExports','dll','reload','duplicateInit']) await withWorker(async ({host}) => {
    const policy=await open(host);
    if(route==='generic') assert.strictEqual(await host.callExport('catalog_startup_noop'),7);
    if(route==='readExports') assert.strictEqual((await host.readExports(['catalog_startup_noop'])).catalog_startup_noop,7);
    if(route==='dll') await host.loadDlls([],exe,{});
    if(route==='reload') { try { await host.loadPe(exe,'notepad.exe'); } catch (_) {} }
    if(route==='duplicateInit') await assert.rejects(()=>host.link._ask({t:'init'}),/one-shot|initial/i);
    assert.strictEqual(await host.getFontCatalogStartupState(),'SEALED',route);
    await assert.rejects(()=>host.installFontCatalog(entries,policy),/sealed|startup|open/i);
    // Even attempting the original loader again cannot restore OPEN.
    try { await host.callExport('load_pe',0); } catch (_) {}
    assert.strictEqual(await host.getFontCatalogStartupState(),'SEALED');
  });
  console.log('PASS generic execution, readExports, DLL dispatch and reload seal startup permanently');

  await withWorker(async ({host}) => {
    await open(host);
    for(const name of ['font_catalog_begin','font_catalog_add','font_catalog_commit','font_catalog_abort']) {
      await assert.rejects(()=>host.callExport(name,0,0,0,0));
      await assert.rejects(()=>host.readExports([name]));
    }
  });
  console.log('PASS generic routes cannot bypass dedicated catalog transaction ownership');
  await withWorker(async ({host})=>{
    assert.strictEqual(await host.getFontCatalogStartupState(),'NEW');
    const rejected=await host.loadPe(new Uint8Array(128),'invalid.exe');
    assert([0,0xffffffff,0xfffffffe,0xfffffffd].includes(rejected),'fixture must fail native PE loading');
    assert.strictEqual(await host.getFontCatalogStartupState(),'SEALED','negative loader sentinel cannot open startup');
    try { await host.loadPe(exe,'notepad.exe'); } catch (_) {}
    assert.strictEqual(await host.getFontCatalogStartupState(),'SEALED','later successful loading cannot reopen failed startup');
    const policy=await host.getFontCatalogExclusions();
    await assert.rejects(()=>host.installFontCatalog([],policy),/startup|open|sealed/i);
  });
  console.log('PASS invalid first PE seals startup permanently, including subsequent valid reload');
  // Secondary initialization uses a distinct real Worker/control slot, without
  // running init_thread or guest code. Catalog diagnostics require no RPC host.
  const worker=new Worker(path.join(ROOT,'lib/guest-worker.js'));
  const exchange=message=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('secondary Worker response timeout'));},10000);
    const cleanup=()=>{clearTimeout(timer);worker.off('message',receive);worker.off('error',failed);};
    const receive=reply=>{cleanup();resolve(reply);};
    const failed=error=>{cleanup();reject(error);};
    worker.on('message',receive);worker.on('error',failed);worker.postMessage(message);
  });
  try {
    const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
    assert.strictEqual((await exchange({t:'init',memory,module:module_,sigs,slot:1})).t,'ready');
    assert.strictEqual((await exchange({t:'getFontCatalogStartupState',seq:1})).state,'SEALED');
    assert((await exchange({t:'installFontCatalog',seq:2,entries:[],expectedExcludedPaths:[]})).error);
    assert.strictEqual((await exchange({t:'init',seq:3})).t,'error');
    assert.strictEqual((await exchange({t:'getFontCatalogStartupState',seq:4})).state,'SEALED');
  } finally { await worker.terminate(); }
  console.log('PASS real secondary Worker starts sealed and duplicate initialization cannot reopen it');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
