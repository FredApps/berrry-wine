#!/usr/bin/env node
'use strict';
// Reuse the existing x87 differential fuzzer, injecting integer bridges and
// comparing all guest GPRs as well as FP payloads/tags/status/exception traces.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert');
const {transform}=require(process.argv.includes('--fp-combos')?'./bench-fp-combos':
  process.argv.includes('--fp-predecode')?'./bench-fp-predecode':
  process.argv.includes('--split-pure')?'./bench-mixed-split':'./bench-mw3-mixed-build');
const {compileClosure}=require('./watx-closure');
const root=path.resolve(process.argv[2]||'build/lazy-games/mw3-mixed2');
const file=path.resolve(__dirname,'../test/test-x87-island-predecode.js');
let source=fs.readFileSync(file,'utf8');
function replace(a,b){assert.equal(source.split(a).length,2,a);source=source.replace(a,b);}
if(process.env.FP_ALL_FUSERS==='1')replace('e.set_x87_fuse_debug(16, 0, -1);',
  'e.set_x87_fuse_debug(31, 0, -1);');
replace('    let seq = genSequence();',`    let seq = genSequence();
    // Safe GPRs: these are not the scratch-memory or SIB address bases.
    const regs=[0,3,5];
    const bridge=()=>{const r=pick(regs);return pick([
      [0x81,0xC0+r,...le32(pick([0,1,12,-1,0x7fffffff,0x80000000]))],
      [0x40+r],[0x48+r]]);};
    seq=seq.flatMap(ins=>ri(3)===0?[ins,bridge()]:[ins]);
    seq.unshift([0xD9,0xE8],bridge(),[0xDD,0xD8]);
    if(process.argv.includes('--fp-combos') && c<6){
      // Exercise the 255-record cap and the remainder island's countdown.
      // Two-byte register operations keep the fixture within its code slot.
      seq.push([0x89,0xD2],[0xD9,0xE8]);
      for(let k=0;k<[2,252,253,254,255,256][c];k++)seq.push([0xD9,0xC8]);
      seq.push([0xDD,0xD8]);
    }
    if(process.env.FP_ALL_FUSERS==='1'){
      // H449 owns the first four records. A dead island starts inside it
      // and extends into the final two standalone operations. Preparation
      // must skip the outer fused span without changing those operands.
      seq.push([0x89,0xD2], [0xD9,0x05,...le32(DATA)],
        [0xD8,0x0D,...le32(DATA+4)], [0xD8,0x05,...le32(DATA+8)],
        [0xD9,0x1D,...le32(DATA+12)], [0xD9,0x05,...le32(DATA+16)],
        [0xD9,0x1D,...le32(DATA+20)]);
    }`);
replace('      eax: e.get_eax() >>> 0,',`      eax: e.get_eax() >>> 0,
      gprs: ['eax','ebx','ecx','edx','esi','edi','ebp','esp'].map(r=>e['get_'+r]()>>>0),`);
replace("'buf', 'eax', 'flags', 'trace'","'buf', 'eax', 'gprs', 'flags', 'trace'");
const child=new Module(file,module);child.filename=file;child.paths=Module._nodeModulePaths(path.dirname(file));
const original=child.require.bind(child);
child.require=id=>id!=='./compile-src'?original(id):{compileSrcWasm:extra=>{
  const vfs=new Map();for(const n of fs.readdirSync(root+'/src'))if(/\.watx?$/.test(n)){
    const s=extra(n,transform(n,fs.readFileSync(root+'/src/'+n,'utf8')));
    for(const key of [n,'src/'+n,'./'+n])vfs.set(key,s);
  }
  const r=compileClosure({source:vfs.get('main.watx'),vfs,entry:'src/main.watx'},{tailCalls:true});
  assert(r.success,r.error);return Buffer.from(r.wasmBinary);
}};
child._compile(source,file);
