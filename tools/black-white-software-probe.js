#!/usr/bin/env node
'use strict';
// Read-only guest diagnostic. Reuse CLI control and EIP tracing, not a second
// emulator host. Usage: node tools/black-white-software-probe.js --seconds=60
// --game=/path/to/MainApp --wasm=/path/to/current.wasm [--no-build]
// [--capture-every=60] keeps periodic frames during long progression runs.
// [--control-stdin] relays existing CLI JSON controls while sampling continues;
// replies use the original caller id and the standard [ctl] prefix.
// [--max-batches=1000000000] is a secondary guard; --seconds is the wall budget.
// [--allocation-probe] captures the 10.3MiB gameplay allocation return,
// keeping the debugger armed through earlier allocations at the shared site.
// [--skip-intro] ends the opening sequence as soon as the EIP trace names its
// object, reaching the main menu in about ninety seconds instead of software
// rendering1787 frames. 0x00529433 is the engine's own exit test --
//   eax = [esi+0x24]; if (eax != -1 && [esi+0x20] > eax) return "finished"
// -- and 0x00529421 is where the engine itself arms that field, frame+500,
// once the completion float at [esi+0x28] passes its threshold. Writing it
// early puts the intro in exactly the state it ends in; nothing else is poked.
const fs=require('fs'),path=require('path'),os=require('os'),readline=require('readline');
const {spawn}=require('child_process');
const {setTimeout:delay}=require('timers/promises');
const {OPCODES}=require('../lib/d3d-command-stream');
const {installBwAllocationObserver}=require('./bw-allocation-observer');
const args=process.argv.slice(2),arg=(name,fallback)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const seconds=Number(arg('seconds','60'));
// Software rendering on a loaded host can spend more than thirty minutes in
// the unmodified intro alone. Keep an explicit guard, but allow gameplay runs.
if(!Number.isFinite(seconds)||seconds<1||seconds>14400)throw Error('seconds must be1..14400');
const maxBatches=Number(arg('max-batches','1000000000'));
if(!Number.isSafeInteger(maxBatches)||maxBatches<1)throw Error('max-batches must be a positive safe integer');
const captureEvery=Number(arg('capture-every','0'));
if(!Number.isFinite(captureEvery)||(captureEvery!==0&&(captureEvery<10||captureEvery>1800)))
  throw Error('capture-every must be0 (off) or10..1800 seconds');
// The default used to be an extraction under /private/tmp. macOS reaps files
// there once they go three days without a read, and it reaps FILES while
// leaving the directory tree standing -- so the install went 366 files to 45
// with `find -type d` still looking healthy, and BW2Demo.exe exited cleanly on
// a missing Data\Text\BW2Text.bin in a way that read convincingly as an
// emulator regression. Cost a session. Point at the durable in-repo install.
const game=path.resolve(arg('game',path.join(__dirname,'..','test','binaries',
  'win98-games-a-d','Black and White 2-DX9-D3D','installed')));
const output=fs.mkdtempSync(path.join(os.tmpdir(),'bw-software-probe-'));
const root=path.resolve(__dirname,'..');
const flags=[`--exe=${path.join(game,'BW2Demo.exe')}`,'--vfs-include=**/*',
  `--dll-seed=${['d3dx9_25.dll','binkw32.dll','dbghelp.dll'].map(f=>path.join(game,f)).join(',')}`,
  '--d3d9-renderer=software','--d3d9-programmable','--control-stdin','--real-ticks',
  // The land commits the whole 316MB sparse backing pool and then asks for
  // more, so this app is the reason run.js has --memory-mb at all: everything
  // above 0x20000000 is the extension backing window. Matches the `bigMemory`
  // flag lib/apps.js gives it in the browser. 2048 rather than 1024 because
  // 1024 was measured short -- 792MB live when the land loader asks for one
  // more 430MB range, against the 828MB a 1GB memory provides.
  '--memory-mb=2048',
  '--quiet-api','--quiet-blocks','--batch-size=200000',`--max-batches=${maxBatches}`,`--max-seconds=${seconds+30}`,
  '--trace-eip-range=0x00526d93-0x00526d97','--trace-eip-detail','--trace-eip-stream'];
if(arg('wasm',null))flags.push(`--wasm=${path.resolve(arg('wasm'))}`,'--no-build');
else if(args.includes('--no-build'))flags.push('--no-build');
if(args.includes('--allocation-probe'))flags.push('--dump-virtual-maps');
// Repeatable pass-through for any run.js flag this probe does not name itself,
// so a one-off diagnostic -- --fault-null, --trace-sched, a --count probe --
// does not need its own option added here every time.
for(const a of args)if(a.startsWith('--extra='))flags.push(a.slice('--extra='.length));
(async()=>{
  console.log('Artifacts:',output,'loadavg:',os.loadavg());
  const log=fs.createWriteStream(path.join(output,'run.log')),records=fs.createWriteStream(path.join(output,'samples.ndjson'));
  const child=spawn(process.execPath,['test/run.js',...flags],{cwd:root,stdio:['pipe','pipe','pipe']});
  let seq=0,introObject=0,traceHits=0,ended=false,stopRequested=false,controls;const pending=new Map();
  const exited=new Promise((resolve,reject)=>{
    child.on('error',reject);
    child.on('exit',(code,signal)=>{ended=true;for(const p of pending.values())p.reject(Error(`CLI exited ${code}/${signal}`));pending.clear();resolve({code,signal});});
  });
  child.stderr.on('data',data=>log.write(data));
  readline.createInterface({input:child.stdout}).on('line',line=>{
    log.write(line+'\n');
    if(/^\[EIP\] 0x0*526d93\b/i.test(line)){
      const match=line.match(/\bESI=(0x[0-9a-f]+)/i);if(match){introObject=Number(match[1]);traceHits++;}
    }
    if(!line.startsWith('[ctl] '))return;
    const reply=JSON.parse(line.slice(6)),p=pending.get(reply.id);if(!p)return;
    pending.delete(reply.id);reply.ok?p.resolve(reply.value):p.reject(Error(reply.error));
  });
  const command=(action,fields={})=>new Promise((resolve,reject)=>{
    if(ended){reject(Error('CLI already exited'));return;}
    const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,action,...fields})+'\n');
  });
  const evaluate=code=>command('eval',{code});
  if(args.includes('--control-stdin')){
    controls=readline.createInterface({input:process.stdin});
    controls.on('line',async line=>{
      let request;
      try{
        request=JSON.parse(line);
        if(!request||typeof request.action!=='string')throw Error('control action must be a string');
        const {id,action,...fields}=request;
        if(action==='quit')stopRequested=true;
        const value=await command(action,fields);
        console.log('[ctl] '+JSON.stringify({id,ok:true,value}));
      }catch(error){
        console.log('[ctl] '+JSON.stringify({id:request?.id??null,ok:false,error:String(error)}));
      }
    });
  }
  const deadline=setTimeout(()=>child.kill('SIGTERM'),(seconds+150)*1000);
  try{
    await command('ping');
    if(args.includes('--allocation-probe')){
      // Load after the CLI's build/ping, and honor WINE_REGION_MAP just as
      // run.js does when checking the loaded WASM's layout stamp.
      const RegionMap=require('../lib/region-map.generated');
      const options={layoutHash:RegionMap.LAYOUT_HASH,regionMap:Object.fromEntries(
        ['VIRTUAL_MAP_STATE','VIRTUAL_MAP_TABLE','VIRTUAL_BACKING_BASE','HEAP_ARENAS'].map(n=>[n,RegionMap.REGIONS[n]]))};
      console.log('Allocation observer:',await evaluate(`(${installBwAllocationObserver.toString()})(instance,exports,ctx,tickState,${JSON.stringify(options)})`));
    }
    await evaluate(`(()=>{
      const b=ctx.d3d9Bridge,submit=b._submit,op=${JSON.stringify(OPCODES)};
      const p=ctx.bwSoftwareProbe={submitted:{},completed:{},failed:0,lastError:null,categories:{}};
      b._submit=function(entry,code,payload){
        p.submitted[code]=(p.submitted[code]||0)+1;
        if(code===op.DRAW){
          const key=[payload.primitive,payload.primitiveCount,!!payload.vertexShader,!!payload.pixelShader,
            ...payload.textures.map(t=>t?t.width+'x'+t.height+':'+(t.levels?.length||1):'-')].join('/');
          if(p.categories[key]!==undefined||Object.keys(p.categories).length<64)p.categories[key]=(p.categories[key]||0)+1;
        }
        const failed=error=>{p.failed++;p.lastError=String(error);};
        try{
          const result=submit.call(this,entry,code,payload);
          if(result&&typeof result.then==='function')result.then(()=>p.completed[code]=(p.completed[code]||0)+1,failed);
          else p.completed[code]=(p.completed[code]||0)+1;
          return result;
        }catch(error){failed(error);throw error;}
      };return true;
    })()`);
    // Attach to the running real-time guest. Frozen mode intentionally uses a
    // different clock; these counters cover only the observed attachment window.
    const start=performance.now();
    let nextCapture=captureEvery,skipped=false;
    while(!stopRequested&&!ended&&performance.now()-start<seconds*1000){
      await delay(Math.min(5000,Math.max(1,seconds*1000-(performance.now()-start))));
      if(stopRequested||ended)break;
      const sample=await evaluate(`(()=>{
        const b=ctx.d3d9Bridge,o=${introObject},read=a=>exports.guest_read32(a)>>>0;
        return {probe:ctx.bwSoftwareProbe,queues:Array.from(b.devices,([id,e])=>({id,submitted:e.queue.submitted,
          consumed:e.queue.consumed,completed:e.queue.completed,error:e.queue.error?String(e.queue.error):null})),
          pending:b.requests.size,eip:exports.get_eip()>>>0,intro:o?{object:o,frame:read(o+32),target:read(o),
          finishFrame:read(o+36),completion:new Float32Array(new Uint32Array([read(o+40)]).buffer)[0]}:null};
      })()`);
      const record={seconds:(performance.now()-start)/1000,traceHits,...sample};
      records.write(JSON.stringify(record)+'\n');console.log(JSON.stringify(record));
      if(args.includes('--skip-intro')&&!skipped&&sample.intro&&sample.intro.finishFrame===0xffffffff){
        skipped=true;
        console.log('Intro skip:',await evaluate(`(()=>{const o=${introObject};
          const frame=exports.guest_read32(o+32)>>>0;
          exports.guest_write32(o+36,(frame-1)>>>0);
          return {frame,finishFrame:exports.guest_read32(o+36)>>>0};})()`));
      }
      if(captureEvery&&record.seconds>=nextCapture){
        const filename=`frame-${String(Math.floor(record.seconds)).padStart(4,'0')}.png`;
        await command('png',{path:path.join(output,filename)});
        nextCapture=(Math.floor(record.seconds/captureEvery)+1)*captureEvery;
      }
    }
    if(!stopRequested&&!ended){
      await command('png',{path:path.join(output,'frame.png')});await command('quit');
    }
    const result=await exited;if(result.code!==0)throw Error(`CLI failed ${JSON.stringify(result)}`);
  }catch(error){
    // A relayed quit can race an outstanding sample or the initial handshake.
    // Only an explicitly requested, successful child exit is a normal stop.
    if(!stopRequested)throw error;
    const result=await exited;if(result.code!==0)throw error;
  }finally{
    controls?.close();
    clearTimeout(deadline);if(!ended){child.kill('SIGTERM');await exited;}
    log.end();records.end();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
