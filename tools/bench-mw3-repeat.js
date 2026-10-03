#!/usr/bin/env node
'use strict';
// Uses the frozen checkout's own MW3 route, modules and runner.
const fs=require('fs'),path=require('path'),cp=require('child_process'),vm=require('vm'),os=require('os'),crypto=require('crypto'),assert=require('assert');
const [runnerArg,modulesArg,outArg,orderArg='p,pc,pc,p']=process.argv.slice(2);
assert(outArg,'RUNNER MODULES OUT ORDER');
const order=orderArg.split(',');
assert(order.every(v=>['p','pc','pcm','pcp'].includes(v)), 'unknown variant');
const runner=path.resolve(runnerArg),modules=path.resolve(modulesArg),out=path.resolve(outArg);
assert(!fs.existsSync(out)||fs.readdirSync(out).length===0,'output must be a fresh directory');
fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(runner,'tools/uop-game-ab.js'),'utf8');
const routeText=source.match(/  mw3: (\{[\s\S]*?\n  \}),\n  q2:/);assert(routeText,'MW3 route seam');
const route=vm.runInNewContext('('+routeText[1]+')');
const end=Number(process.env.FP_END||3550),start=Number(process.env.FP_START||1150);
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const meta={node:process.version,v8:process.versions.v8,cpu:os.cpus()[0].model,load:os.loadavg(),command:process.argv,
  start,end,filetimeEpoch:process.env.FP_FILETIME_EPOCH||null,sharedCalendar:!!process.env.FP_SHARE_CALENDAR,diagnostic:!!process.env.FP_DIAG,
  profile:!!process.env.FP_PROFILE,clockAudit:!!process.env.FP_CLOCK_AUDIT,
  hashes:Object.fromEntries(['test/run.js','host.js','lib/apps.js','lib/filesystem.js','lib/worker-imports.js','lib/host-imports.js'].map(f=>[f,sha(path.join(runner,f))])),
  helpers:Object.fromEntries(['bench-mw3-repeat.js','bench-fp-filetime-pin.js'].map(f=>[f,sha(path.join(__dirname,f))])),
  modules:Object.fromEntries([...new Set(order)].map(v=>[v,sha(path.join(modules,v,'candidate.wasm'))]))};
fs.writeFileSync(path.join(out,'host.json'),JSON.stringify(meta,null,2));
const seen={};
for(const arm of order){
  const tag=arm+(seen[arm]=(seen[arm]||0)+1),stem=path.join(out,tag);
  const env={...process.env};if(process.env.FP_DIAG)env.FP_BATCH_TRACE=stem+'.batches.jsonl';
  // Keep normal tiering; preserve the actual game's generated native code.
  const nativeFlags=process.env.FP_PROFILE?['--perf-prof',`--perf-prof-path=${stem}.native`]:[];
  if(nativeFlags.length){
    fs.mkdirSync(stem+'.native');
    fs.writeFileSync(stem+'.native/capture.json',JSON.stringify({node:process.version,v8:process.versions.v8,arch:process.arch,
      tier:'normal tiering; jitdump labels distinguish Liftoff/TurboFan',flags:nativeFlags,wasmSha256:meta.modules[arm]},null,2));
  }
  const args=[...nativeFlags,...((env.FP_FILETIME_EPOCH||env.FP_SHARE_CALENDAR||env.FP_CLOCK_AUDIT)?['--require',path.join(__dirname,'bench-fp-filetime-pin.js')]:[]),
    process.env.FP_DIAG?'test/run-fp-repeat.js':'test/run.js','--app=mw3','--no-build','--quiet-api','--quiet-blocks','--no-close',
    ...route.args.filter(a=>!a.startsWith('--max-batches=')&&!a.startsWith('--cpu-window=')),
    '--branch-clock','--uop','--x87-fusion',`--wasm=${path.join(modules,arm,'candidate.wasm')}`,
    `--max-batches=${end}`,'--max-seconds=1200',`--input=${route.input.join(',')}`,`--png=${stem}.png`,
    ...(end>start?[`--cpu-window=${start}:${end}`,`--slice-split=${start}`]:[]),
    ...(process.env.FP_PROFILE?[`--cpu-prof-window=${start}:${end}:${stem}.cpuprofile`]:[])];
  fs.writeFileSync(stem+'.command.json',JSON.stringify({args,epoch:env.FP_FILETIME_EPOCH||null,startedAt:new Date().toISOString(),load:os.loadavg()},null,2));
  const fd=fs.openSync(stem+'.log','w');let r;
  try{r=cp.spawnSync('/usr/bin/time',['-p',process.execPath,...args],{cwd:runner,env,stdio:['ignore',fd,fd],timeout:1300000});}
  finally{fs.closeSync(fd);}
  console.log(tag,r.status,r.error?.message||'');assert.equal(r.status,0,tag);
  const text=fs.readFileSync(stem+'.log','utf8');assert(new RegExp(`Stats: \\d+ API calls, ${end} batches`).test(text),`truncated ${tag}`);
}
