#!/usr/bin/env node
'use strict';
// Exercise the actual probe script with a protocol-only child: no guest launch,
// filesystem writes, rendering, or wall-clock wait is needed for relay races.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {EventEmitter}=require('events');
const source=fs.readFileSync(path.join(__dirname,'../tools/black-white-software-probe.js'),'utf8');
async function run(earlyQuit){
  const child=new EventEmitter(),input=new EventEmitter(),output=new EventEmitter();
  child.stdout=output;child.stderr=new EventEmitter();
  const readers=new Map(),sent=[],printed=[];
  let ends=0,resolveDone,closed=false,quit=false;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const processMock={argv:['node','probe','--seconds=7200','--control-stdin'],stdin:input,execPath:process.execPath};
  const receive=value=>readers.get(output).emit('line','[ctl] '+JSON.stringify(value));
  child.stdin={write(line){
    const request=JSON.parse(line);sent.push(request);
    queueMicrotask(()=>{
      if(request.action==='quit'){
        receive({id:request.id,ok:true,value:true});child.emit('exit',0,null);return;
      }
      if(earlyQuit&&request.action==='ping'&&!quit){
        quit=true;readers.get(input).emit('line',JSON.stringify({id:'quit',action:'quit'}));
        // Leave the initial handshake pending: the orderly quit rejects it.
        return;
      }
      receive({id:request.id,ok:true,value:request.action==='ping'?{pong:true}:true});
    });
  }};
  child.kill=()=>assert.fail('orderly relay quit must not kill the child');
  const stream=()=>({write(){},end(){if(++ends===2)resolveDone();}});
  const modules={
    fs:{mkdtempSync:()=>'/probe-test',createWriteStream:stream},path,
    os:{tmpdir:()=>'/tmp',loadavg:()=>[0,0,0]},
    readline:{createInterface({input:handle}){
      const reader=new EventEmitter();reader.close=()=>{closed=true;};readers.set(handle,reader);return reader;
    }},
    child_process:{spawn:()=>child},
    'timers/promises':{setTimeout:async()=>{
      const reader=readers.get(input);
      reader.emit('line','{');
      reader.emit('line',JSON.stringify({id:'bad',action:42}));
      reader.emit('line',JSON.stringify({id:'external',action:'ping'}));
      reader.emit('line',JSON.stringify({id:'quit',action:'quit'}));
    }},
    '../lib/d3d-command-stream':require('../lib/d3d-command-stream'),
  };
  vm.runInNewContext(source,{
    require:name=>{assert(name in modules,`unexpected dependency ${name}`);return modules[name];},
    __dirname:path.join(__dirname,'../tools'),process:processMock,
    console:{log:value=>printed.push(value),error:error=>printed.push(String(error))},
    performance:{now:()=>0},setTimeout:()=>1,clearTimeout(){},
  },{filename:'black-white-software-probe.js'});
  await done;
  assert.strictEqual(processMock.exitCode,undefined,'intentional quit is successful');
  assert(closed,'stdin reader closes on completion');
  assert.strictEqual(new Set(sent.map(r=>r.id)).size,sent.length,'internal request ids are unique');
  assert(sent.every(r=>Number.isInteger(r.id)),'caller ids never overwrite internal ids');
  const replies=printed.filter(line=>line.startsWith('[ctl] ')).map(line=>JSON.parse(line.slice(6)));
  assert(replies.some(r=>r.id==='quit'&&r.ok),'quit reply preserves caller id');
  if(!earlyQuit){
    assert(replies.some(r=>r.id===null&&!r.ok),'malformed JSON is rejected without stopping sampling');
    assert(replies.some(r=>r.id==='bad'&&!r.ok),'invalid action is rejected');
    assert(replies.some(r=>r.id==='external'&&r.ok&&r.value.pong),'ping is relayed with caller id');
  }
}
(async()=>{
  await run(false);await run(true);
  console.log('PASS Black & White probe relay: ids, validation, orderly quit and pending-handshake race');
})().catch(error=>{console.error(error);process.exitCode=1;});
