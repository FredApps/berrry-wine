'use strict';
// Execute the actual generated click block without a browser or guest.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
async function test(file){
  const source=fs.readFileSync(file,'utf8');
  new vm.Script(source);
  const start=source.indexOf("try{row.activationToken='antara-'"),end=source.indexOf('row.finishedAt=',start);
  if(start<0||end<start)throw Error('generated click block absent');
  const block=source.slice(start,end);
  for(const rejectAck of [false,true]){
    const events=[],row={},failure=Error('ACK refused');
    const page={evaluateHandle:async()=>({}),evaluate:async(fn,...args)=>{
      if(args.at(-1)==='down'||args.at(-1)==='up'){events.push('ACK-'+args.at(-1));if(rejectAck)throw failure;return[{active:true}];}
      return{};
    },mouse:{move:async(x,y,opts)=>{assert.deepEqual([x,y],[411,167]);assert.equal(opts.steps,4);events.push('MOVE');},down:async()=>events.push('DOWN'),up:async()=>events.push('UP')}};
    const result=await vm.runInNewContext('(async()=>{let primary;'+block+'return primary;})()',{
      row,page,c:{x:411,y:167},activateExisting(){},setTimeout(fn,ms){assert.equal(ms,150);events.push('SETTLE');fn();},pause:async()=>{},Date,Promise
    });
    if(rejectAck){assert.equal(result,failure);assert.deepEqual(events,['ACK-down']);}
    else {assert.equal(result,undefined);assert.deepEqual(events,['ACK-down','MOVE','SETTLE','DOWN','ACK-up','UP']);}
  }
  console.log('Actual generated driver ACK → ordinary MOVE → settle → DOWN/UP, failed ACK refuses all mouse input PASS');
}
if(require.main===module)test(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={test};
