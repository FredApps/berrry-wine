#!/usr/bin/env node
'use strict';
// V8 perf-prof method from wasm-native.js, retaining original code addresses
// so PC-relative calls remain meaningful. Compile-only optimized-tier capture.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process'),crypto=require('crypto');
const [mode,wasmArg,namedArg,outArg]=process.argv.slice(2);
assert(outArg,'capture-d8|capture-chrome|decode WASM NAMED_WASM OUTDIR');
const wasm=path.resolve(wasmArg),named=path.resolve(namedArg),out=path.resolve(outArg);
const flags=['--perf-prof','--no-liftoff','--no-wasm-lazy-compilation'];
async function main(){
  if(mode.startsWith('capture-')){
    assert(!fs.existsSync(out),'fresh capture directory required');fs.mkdirSync(out,{recursive:true});
    let engine;
    if(mode==='capture-d8'){
      const d8=process.env.D8||path.join(require('os').homedir(),'.jsvu/bin/v8');
      const script=out+'/compile.js';fs.writeFileSync(script,`new WebAssembly.Module(readbuffer(${JSON.stringify(wasm)}));`);
      engine=cp.execFileSync(d8,['--version'],{encoding:'utf8'}).trim();
      cp.execFileSync(d8,[...flags,script],{cwd:out,stdio:'inherit'});
    }else{
      const browser=await require('puppeteer').launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',headless:false,
        args:['--no-sandbox','--no-first-run',`--js-flags=${flags.join(' ')} --perf-prof-path=${out}`]});
      try{engine=await browser.version();const page=await browser.newPage();await page.evaluate(s=>{globalThis.nativeProbe=new WebAssembly.Module(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));},fs.readFileSync(wasm).toString('base64'));}
      finally{await browser.close();}
    }
    fs.writeFileSync(out+'/capture.json',JSON.stringify({engine,arch:process.arch,flags,wasmSha256:crypto.createHash('sha256').update(fs.readFileSync(wasm)).digest('hex')},null,2));
    console.log('captured',out,engine);return;
  }
  assert.equal(mode,'decode');const names=new Map();
  for(const raw of WebAssembly.Module.customSections(new WebAssembly.Module(fs.readFileSync(named)),'name')){
    const b=Buffer.from(raw);let p=0;const u=()=>{let x=0,s=0,v;do{v=b[p++];x|=(v&127)<<s;s+=7;}while(v&128);return x>>>0;};
    while(p<b.length){const kind=u(),size=u(),end=p+size;if(kind===1){const n=u();for(let i=0;i<n;i++){const idx=u(),len=u();names.set(idx,b.toString('utf8',p,p+len));p+=len;}}p=end;}
  }
  const wanted=new Set(process.env.NATIVE_FUNCS ? process.env.NATIVE_FUNCS.split(',') : ['x87_island_fast','x87_island_generic','x87_island_fuse_block','uop_fast']);const records=[],allRecords=[];
  const objdump=process.env.OBJDUMP||'/opt/homebrew/opt/binutils/bin/objdump';
  for(const file of fs.readdirSync(out).filter(n=>/^jit-.*\.dump$/.test(n))){
    const b=fs.readFileSync(out+'/'+file);if(b.length<40)continue;assert.equal(b.readUInt32LE(0),0x4a695444);
    const arch=b.readUInt32LE(12);assert([62,183].includes(arch));let p=b.readUInt32LE(8);
    while(p+16<=b.length){const id=b.readUInt32LE(p),size=b.readUInt32LE(p+4);assert(size>=16);
      // Chrome shutdown can interrupt an unrelated final record. Never decode
      // partial code; all requested objects below must still be complete.
      if(p+size>b.length){console.warn('truncated final record',file,p,size,b.length-p);break;}
      if(id===0){const addr=b.readBigUInt64LE(p+32),n=Number(b.readBigUInt64LE(p+40)),end=b.indexOf(0,p+56);assert(end>=p+56&&end<p+size);
        const label=b.toString('utf8',p+56,end),m=/wasm-function\[(\d+)\]/.exec(label);assert(end+1+n<=p+size);
        if(m&&label.includes('turbofan'))allRecords.push({name:names.get(+m[1]),index:+m[1],address:'0x'+addr.toString(16),bytes:n,arch});
        if(m&&label.includes('turbofan')&&wanted.has(names.get(+m[1]))){const name=names.get(+m[1]),bin=out+'/'+name+'.bin';
          fs.writeFileSync(bin,b.subarray(end+1,end+1+n));
          const asm=cp.execFileSync(objdump,['-b','binary','-m',arch===62?'i386:x86-64':'aarch64','-D','--adjust-vma=0x'+addr.toString(16),bin],{encoding:'utf8',maxBuffer:16<<20});
          fs.writeFileSync(out+'/'+name+'.asm',asm);records.push({name,index:+m[1],address:'0x'+addr.toString(16),bytes:n,arch});
        }
      }p+=size;
    }
  }
  assert.equal(new Set(records.map(r=>r.name)).size,wanted.size,'all requested functions captured');
  fs.writeFileSync(out+'/all-functions.json',JSON.stringify(allRecords,null,2));
  fs.writeFileSync(out+'/functions.json',JSON.stringify(records,null,2));console.log(records);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
