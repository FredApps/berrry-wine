#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const {VirtualFS}=require('../lib/filesystem');
const {nodeDirStore}=require('../lib/overlay-store');
const VfsOverlay=require('../lib/vfs-overlay');
const root=path.resolve(__dirname,'..');

function fixture(dll){
 const b=Buffer.alloc(0x2200),pe=0x80,opt=pe+24,section=opt+0xe0;
 b.writeUInt16LE(0x5a4d);b.writeUInt32LE(pe,0x3c);b.writeUInt32LE(0x4550,pe);
 b.writeUInt16LE(0x14c,pe+4);b.writeUInt16LE(1,pe+6);b.writeUInt16LE(0xe0,pe+20);b.writeUInt16LE(dll?0x210e:0x10e,pe+22);
 b.writeUInt16LE(0x10b,opt);b.writeUInt32LE(0x1000,opt+16);b.writeUInt32LE(0x1000,opt+20);
 b.writeUInt32LE(dll?0x10000000:0x400000,opt+28);b.writeUInt32LE(0x1000,opt+32);b.writeUInt32LE(0x200,opt+36);
 b.writeUInt32LE(0x3000,opt+56);b.writeUInt32LE(0x200,opt+60);b.writeUInt16LE(3,opt+68);
 b.writeUInt32LE(0x100000,opt+72);b.writeUInt32LE(0x1000,opt+76);b.writeUInt32LE(0x100000,opt+80);b.writeUInt32LE(0x1000,opt+84);b.writeUInt32LE(16,opt+92);
 b.writeUInt32LE(0x1800,opt+104);b.writeUInt32LE(40,opt+108);
 b.write('.text\0\0\0',section);b.writeUInt32LE(0x2000,section+8);b.writeUInt32LE(0x1000,section+12);
 b.writeUInt32LE(0x2000,section+16);b.writeUInt32LE(0x200,section+20);b.writeUInt32LE(0xe0000060,section+36);
 const at=rva=>rva-0x1000+0x200;
 const apis=['OutputDebugStringA','CreateFileA','ReadFile','CloseHandle','ExitProcess'];
 b.writeUInt32LE(0x1900,at(0x1800));b.writeUInt32LE(0x1880,at(0x1800)+12);b.writeUInt32LE(0x1940,at(0x1800)+16);b.write('KERNEL32.dll\0',at(0x1880));
 let cursor=0x1a00;
 apis.forEach((name,i)=>{b.writeUInt32LE(cursor,at(0x1900)+i*4);b.writeUInt32LE(cursor,at(0x1940)+i*4);b.write(name+'\0',at(cursor)+2);cursor+=name.length+3;});
 b.write('c:\\final-sentinel.bin\0',at(0x1c00));
 b.write('CLI_DLL_FINAL_VFS_OK\0',at(0x1c40));b.write('CLI_DLL_FINAL_VFS_BAD\0',at(0x1c80));b.write('CLI_MAIN_ENTERED\0',at(0x1cc0));
 const code=[],emit=(...v)=>code.push(...v),u32=n=>emit(n&255,n>>>8&255,n>>>16&255,n>>>24&255);
 const push=n=>{emit(0x68);u32(n);},ptr=r=>{emit(0x8d,0x83);u32(r);emit(0x50);};
 const call=name=>{emit(0xff,0x93);u32(0x1940+apis.indexOf(name)*4);};
 emit(0x53,0xe8,0,0,0,0,0x5b,0x81,0xeb);u32(0x1006); // position-independent EBX=image base
 if(dll){
  emit(0x56); // preserve callee-saved ESI across DllMain
  push(0);push(0x80);push(3);push(0);push(1);push(0x80000000);ptr(0x1c00);call('CreateFileA');
  emit(0x89,0xc6);push(0);ptr(0x1d10);push(1);ptr(0x1d00);emit(0x56);call('ReadFile');
  emit(0x80,0xbb);u32(0x1d00);emit(0x5a,0x75);const branch=code.length;emit(0);
  ptr(0x1c40);call('OutputDebugStringA');emit(0xeb);const jump=code.length;emit(0);
  const bad=code.length;ptr(0x1c80);call('OutputDebugStringA');const done=code.length;
  code[branch]=bad-branch-1;code[jump]=done-jump-1;
  emit(0x56);call('CloseHandle');emit(0xb8,1,0,0,0,0x5e,0x5b,0xc2,12,0);
 }else{ptr(0x1cc0);call('OutputDebugStringA');push(0);call('ExitProcess');emit(0x5b,0xc3);}
 Buffer.from(code).copy(b,0x200);return b;
}
(async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wa-cli-font-bootstrap-'));
try{
 const exe=path.join(dir,'probe.exe'),dll=path.join(dir,'probe.dll'),sentinel=path.join(dir,'sentinel.bin'),hook=path.join(dir,'observe.js'),bad=path.join(dir,'bad.fon'),empty=path.join(dir,'empty.fon');
 fs.writeFileSync(exe,fixture(false));fs.writeFileSync(dll,fixture(true));fs.writeFileSync(sentinel,Buffer.from([0x5a]));fs.writeFileSync(bad,Buffer.alloc(128,0xa5));fs.writeFileSync(empty,Buffer.alloc(0));
 // Observe actual compiled state at the CLI's loader boundary, then delegate
 // without replacing any loader, parser, or initializer behavior.
 fs.writeFileSync(hook,`const assert=require('assert');const loader=require(${JSON.stringify(path.join(root,'lib/dll-loader.js'))});const real=loader.loadDlls;loader.loadDlls=function(e,...args){assert.deepStrictEqual(Array.from({length:5},(_,i)=>e.stock_font_state(i)),[2,2,2,2,2]);assert.strictEqual(e.font_catalog_ready(),1);assert(e.font_catalog_generation()>0);console.log('CLI_STOCK_STATES_READY');return real.call(this,e,...args);};`);
 function run(font,overlay,catalog){
  const args=['--require',hook,path.join(root,'test/run.js'),'--exe='+exe,'--dlls='+dll,'--no-build','--no-renderer','--no-threads','--quiet-api','--quiet-blocks','--trace-api=OutputDebugStringA','--max-batches=10','--batch-size=1000','--max-seconds=15','--vfs-mount='+sentinel+'=c:\\final-sentinel.bin'];
  if(font)args.push('--vfs-mount='+font+'=c:\\windows\\fonts\\system.fon');
  if(overlay)args.push('--overlay-dir='+overlay);
  if(catalog)args.push('--vfs-mount='+catalog+'=c:\\windows\\fonts\\custom-catalog.ttf');
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  assert.ifError(result.error);return {status:result.status,output:(result.stdout||'')+(result.stderr||'')};
 }
 const normal=run();assert.strictEqual(normal.status,0,normal.output);
 assert.match(normal.output,/CLI_STOCK_STATES_READY/);assert.match(normal.output,/CLI_DLL_FINAL_VFS_OK/);assert.doesNotMatch(normal.output,/CLI_DLL_FINAL_VFS_BAD/);assert.match(normal.output,/CLI_MAIN_ENTERED/);
 assert(normal.output.indexOf('CLI_STOCK_STATES_READY')<normal.output.indexOf('CLI_DLL_FINAL_VFS_OK'));
 assert(normal.output.indexOf('CLI_DLL_FINAL_VFS_OK')<normal.output.indexOf('CLI_MAIN_ENTERED'));
 console.log('PASS real CLI installs all stock fonts and final explicit VFS mount before guest DllMain and main');
 for(const font of [bad,empty]){
  const failed=run(font);assert.notStrictEqual(failed.status,0,failed.output);
  assert.doesNotMatch(failed.output,/CLI_STOCK_STATES_READY|CLI_DLL_FINAL_VFS_OK|CLI_DLL_FINAL_VFS_BAD|CLI_MAIN_ENTERED/,failed.output);
 }
 console.log('PASS malformed and empty required stock fonts fail CLI launch before guest initialization');
 const goodTtf=path.join(root,'fonts','subset','LiberationSans-Regular.ttf');
 assert(fs.existsSync(goodTtf),goodTtf);
 const catalogGood=run(null,null,goodTtf);
 assert.strictEqual(catalogGood.status,0,catalogGood.output);
 assert.match(catalogGood.output,/CLI_DLL_FINAL_VFS_OK/);
 const catalogBad=run(null,null,bad);
 assert.notStrictEqual(catalogBad.status,0,catalogBad.output);
 assert.doesNotMatch(catalogBad.output,/CLI_STOCK_STATES_READY|CLI_DLL_FINAL_VFS_OK|CLI_MAIN_ENTERED/);
 console.log('PASS custom TTF catalog succeeds and malformed TTF prevents CLI guest initialization');
 async function makeOverlay(name,fontMode){
  const target=path.join(dir,name),vfs=new VirtualFS();
  if(fontMode==='whiteout')vfs.files.set('c:\\windows\\fonts\\system.fon',{data:Uint8Array.of(1),attrs:0x20});
  if(fontMode==='catalog-whiteout')vfs.files.set('c:\\windows\\fonts\\custom-catalog.ttf',{data:Uint8Array.of(1),attrs:0x20});
  const tracker=VfsOverlay.attach(vfs,{store:nodeDirStore(target)});
  function write(name,bytes){const h=vfs.createFile(name,0x40000000,2);assert(h);assert(vfs.writeFile(h,bytes,bytes.length).ok);vfs.closeHandle(h);}
  write('c:\\final-sentinel.bin',Uint8Array.of(0x5a));
  if(fontMode==='malformed')write('c:\\windows\\fonts\\system.fon',new Uint8Array(128).fill(0xa5));
  if(fontMode==='whiteout')assert(vfs.deleteFile('c:\\windows\\fonts\\system.fon'));
  if(fontMode==='catalog-valid')write('c:\\windows\\fonts\\custom-catalog.ttf',new Uint8Array(fs.readFileSync(goodTtf)));
  if(fontMode==='catalog-malformed')write('c:\\windows\\fonts\\custom-catalog.ttf',new Uint8Array(128).fill(0xa5));
  if(fontMode==='catalog-whiteout')assert(vfs.deleteFile('c:\\windows\\fonts\\custom-catalog.ttf'));
  const report=await tracker.flush();assert.strictEqual(report.failed,0,JSON.stringify(report.errors));
  tracker.detach();return target;
 }
 fs.writeFileSync(sentinel,Buffer.from([0x11]));
 const replay=run(null,await makeOverlay('overlay-good'));
 assert.strictEqual(replay.status,0,replay.output);assert.match(replay.output,/CLI_STOCK_STATES_READY/);
 assert.match(replay.output,/CLI_DLL_FINAL_VFS_OK/);assert.doesNotMatch(replay.output,/CLI_DLL_FINAL_VFS_BAD/);
 assert.match(replay.output,/CLI_MAIN_ENTERED/);
 console.log('PASS real CLI hydrates committed overlay over conflicting base mount before DllMain');
 for(const mode of ['malformed','whiteout']){
  const failed=run(null,await makeOverlay('overlay-'+mode,mode));
  assert.notStrictEqual(failed.status,0,failed.output);
  assert.doesNotMatch(failed.output,/CLI_STOCK_STATES_READY|CLI_DLL_FINAL_VFS_OK|CLI_DLL_FINAL_VFS_BAD|CLI_MAIN_ENTERED/,failed.output);
 }
 console.log('PASS malformed/whiteouted overlay stock font fails before guest initialization');
 for(const mode of ['catalog-valid','catalog-malformed','catalog-whiteout']){
  const result=run(null,await makeOverlay(mode,mode),mode==='catalog-valid'?bad:goodTtf);
  if(mode==='catalog-malformed'){
   assert.notStrictEqual(result.status,0,result.output);
   assert.doesNotMatch(result.output,/CLI_STOCK_STATES_READY|CLI_DLL_FINAL_VFS_OK|CLI_MAIN_ENTERED/);
  }else{
   assert.strictEqual(result.status,0,result.output);
   assert.match(result.output,/CLI_DLL_FINAL_VFS_OK/);assert.match(result.output,/CLI_MAIN_ENTERED/);
  }
 }
 console.log('PASS catalog discovery honors valid/malformed/whiteout overlay over conflicting base TTF');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
