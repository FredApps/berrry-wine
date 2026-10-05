#!/usr/bin/env node
'use strict';
// Isolated experiment: extend H451 across ADD reg,imm / INC / DEC.
// No production file is edited. Existing block-executor eligibility rejects
// the new integer records, preventing partial guest-register publication.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process'),crypto=require('crypto');
const {compileClosure}=require('./watx-closure');
const {layoutHash,appendSection}=require('./region-layout-hash');
function once(s,a,b){assert.equal(s.split(a).length,2,`unique seam: ${a.slice(0,90)}`);return s.replace(a,b);}
const integer='(i32.or (i32.eq (local.get $fn) (i32.const 3)) (i32.or (i32.eq (local.get $fn) (i32.const 64)) (i32.eq (local.get $fn) (i32.const 65))))';
const declarations='\n    (local $mi_addr i32) (local $mi_old i32) (local $mi_imm i32) (local $mi_result i32)';
const integerBody=`
      ;; Only H3/H64/H65 or H188..190 can occur in a validated island.
      (if (i32.lt_u (local.get $fn) (i32.const 66))
        (then
          (local.set $mi_addr (i32.add (global.get $reg_base) (i32.shl (local.get $op) (i32.const 2))))
          (local.set $mi_old (i32.load (local.get $mi_addr)))
          (if (i32.eq (local.get $fn) (i32.const 3))
            (then
              (local.set $mi_imm (i32.load (local.get $cursor)))
              (local.set $cursor (i32.add (local.get $cursor) (i32.const 4)))
              (local.set $mi_result (i32.add (local.get $mi_old) (local.get $mi_imm)))
              (i32.store (local.get $mi_addr) (local.get $mi_result))
              (call $set_flags_add (local.get $mi_old) (local.get $mi_imm) (local.get $mi_result)))
            (else
              (if (i32.eq (local.get $fn) (i32.const 64))
                (then
                  (local.set $mi_result (i32.add (local.get $mi_old) (i32.const 1)))
                  (i32.store (local.get $mi_addr) (local.get $mi_result))
                  (call $set_flags_inc (local.get $mi_old) (local.get $mi_result)))
                (else
                  (local.set $mi_result (i32.sub (local.get $mi_old) (i32.const 1)))
                  (i32.store (local.get $mi_addr) (local.get $mi_result))
                  (call $set_flags_dec (local.get $mi_old) (local.get $mi_result))))))
          (br $mi_next)))`;
function transform(name,text){
  if(name!=='07b-loop-match.wat')return text;
  const edit=(fn,f)=>{const a=text.indexOf('(func $'+fn),b=text.indexOf('(func ',a+6);assert(a>=0&&b>a);text=text.slice(0,a)+f(text.slice(a,b))+text.slice(b);};
  // Keep first and last operations floating-point. Do not absorb trailing
  // integer work or cross terminators/EA_TEMP producers. Existing 255-op cap.
  edit('x87_island_fuse_block',s=>{
    s=once(s,'(local $fn i32) (local $count i32) (local $first_op i32)',
      '(local $fn i32) (local $count i32) (local $first_op i32) (local $mi_last i32)');
    s=once(s,'(local.set $count (i32.const 0))','(local.set $count (i32.const 0)) (local.set $mi_last (i32.const 0))');
    const start=s.indexOf('(block $run_done'),end=s.indexOf('(if (i32.ge_u (local.get $count)',start);
    let run=s.slice(start,end);
    const predicate='(i32.eqz\n                (i32.or';
    run=once(run,predicate,`(i32.eqz\n                (i32.or ${integer}\n                (i32.or`);
    run=once(run,'(i32.eq (local.get $fn) (i32.const 190))))))','(i32.eq (local.get $fn) (i32.const 190)))))))');
    run=once(run,'(local.set $count (i32.add (local.get $count) (i32.const 1)))',
      `(local.set $count (i32.add (local.get $count) (i32.const 1)))
            (if (i32.eqz ${integer}) (then (local.set $mi_last (local.get $count))))`);
    s=s.slice(0,start)+run+`(local.set $count (local.get $mi_last))
          (local.set $j (i32.add (local.get $i) (local.get $count)))
          `+s.slice(end);return s;
  });
  for(const fn of ['x87_island_generic','x87_island_fast'])edit(fn,s=>{
    s=once(s,'(local $count i32) (local $i i32) (local $addr i32)',
      '(local $count i32) (local $i i32) (local $addr i32)'+declarations);
    s=once(s,'(block $done (loop $each','(block $done (loop $each\n      (block $mi_next'+integerBody);
    s=once(s,'(local.set $i (i32.add (local.get $i) (i32.const 1)))',
      ') ;; mixed operation joins normal cursor/count handling\n      (local.set $i (i32.add (local.get $i) (i32.const 1)))');return s;
  });
  return text;
}
module.exports={transform};
if(require.main===module){
  const [revision,outArg,baseline]=process.argv.slice(2);assert(revision&&outArg&&baseline,'REV OUTDIR BASELINE.wasm');
  const out=path.resolve(outArg);assert(!fs.existsSync(out),'use fresh output');fs.mkdirSync(out,{recursive:true});
  cp.execFileSync('tar',['-x','-C',out],{input:cp.execFileSync('git',['archive',revision,'src'],{maxBuffer:64<<20})});
  const vfs=new Map();for(const n of fs.readdirSync(out+'/src'))if(/\.watx?$/.test(n)){
    const t=fs.readFileSync(out+'/src/'+n,'utf8');for(const key of [n,'src/'+n,'./'+n])vfs.set(key,t);
  }
  const closure={source:fs.readFileSync(out+'/src/main.watx','utf8'),vfs,entry:'src/main.watx'};
  const compile=(named=false)=>{const r=compileClosure(closure,{tailCalls:true,nameSection:named});assert(r.success,r.error);const b=appendSection(Buffer.from(r.wasmBinary),layoutHash(r.regions.regions));assert(WebAssembly.validate(b));return b;};
  const base=compile();assert(base.equals(fs.readFileSync(baseline)),'frozen source must reproduce measured baseline');
  fs.writeFileSync(out+'/baseline.wasm',base);fs.writeFileSync(out+'/baseline.named.wasm',compile(true));
  for(const [name,t]of vfs)vfs.set(name,transform(path.basename(name),t));
  fs.writeFileSync(out+'/mixed-loop-match.wat',vfs.get('07b-loop-match.wat'));
  const candidate=compile();fs.writeFileSync(out+'/candidate.wasm',candidate);fs.writeFileSync(out+'/candidate.named.wasm',compile(true));
  const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  const result={revision,baseline:sha(base),candidate:sha(candidate),bytes:[base.length,candidate.length]};
  fs.writeFileSync(out+'/build.json',JSON.stringify(result,null,2));console.log(result);
}
