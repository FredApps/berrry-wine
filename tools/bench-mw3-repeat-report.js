#!/usr/bin/env node
'use strict';
// Validate work independently of timings, including same-artifact controls.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const dir=path.resolve(process.argv[2]);
const host=JSON.parse(fs.readFileSync(path.join(dir,'host.json')));
const runs=fs.readdirSync(dir).filter(f=>/^(p|pc|pcm|pcp)\d+\.log$/.test(f)).map(file=>{
  const tag=file.slice(0,-4),stem=path.join(dir,tag),log=fs.readFileSync(stem+'.log','utf8');
  const stats=/Stats: (\d+) API calls, (\d+) batches/.exec(log);
  const cpu=/\[cpu-window\].*user ([\d.]+)s sys ([\d.]+)s wall ([\d.]+)s/.exec(log);
  const command=JSON.parse(fs.readFileSync(stem+'.command.json'));
  const png=stem+'.png',trace=stem+'.batches.jsonl';
  return {tag,variant:tag.replace(/\d+$/,''),startedAt:command.startedAt||null,
    complete:!!stats&&+stats[2]===host.end,apis:stats?+stats[1]:null,batches:stats?+stats[2]:null,
    cpu:cpu?{user:+cpu[1],system:+cpu[2],wall:+cpu[3]}:null,
    pngHash:fs.existsSync(png)?crypto.createHash('sha256').update(fs.readFileSync(png)).digest('hex'):null,
    counters:log.split('\n').filter(s=>/^uop(?:\[|:| nobump:| hot:)/.test(s)),
    trace:fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').map(s=>JSON.parse(s)):null};
}).sort((a,b)=>(a.startedAt||a.tag).localeCompare(b.startedAt||b.tag));
assert(runs.length,'no runs');
const comparisons=[];
for(let i=1;i<runs.length;i++){
  const a=runs[0],b=runs[i];
  const eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
  let batchTrace=null;
  if(a.trace&&b.trace){
    const length=Math.min(a.trace.length,b.trace.length);
    const first=field=>{
      for(let j=0;j<length;j++)if(!eq(a.trace[j][field],b.trace[j][field]))return a.trace[j].batch;
      return null;
    };
    batchTrace={lengths:[a.trace.length,b.trace.length],firstMain:first('main'),firstThreads:first('threads')};
    batchTrace.equal=a.trace.length===host.end&&b.trace.length===host.end&&batchTrace.firstMain===null&&batchTrace.firstThreads===null;
  }
  comparisons.push({a:a.tag,b:b.tag,sameArtifact:a.variant===b.variant,
    complete:a.complete&&b.complete,pixels:!!a.pngHash&&a.pngHash===b.pngHash,apis:a.apis===b.apis,
    counters:eq(a.counters,b.counters),batchTrace});
}
const summary={};
for(const variant of [...new Set(runs.map(r=>r.variant))]){
  const values=runs.filter(r=>r.variant===variant&&r.complete&&r.cpu).map(r=>r.cpu.user);
  if(values.length){const mean=values.reduce((a,b)=>a+b,0)/values.length;
    summary[variant]={values,mean,rangePercent:100*(Math.max(...values)-Math.min(...values))/mean};}
}
let sameArtifactControl=null,balancedAfterControl=null;
if(runs.length===6&&runs.map(r=>r.variant).join(',')==='p,p,pc,p,p,pc'&&runs.every(r=>r.complete&&r.cpu)){
  const [a,b,c,d,e,f]=runs.map(r=>r.cpu.user);
  sameArtifactControl={p:[a,b],changePercent:100*(b/a-1),rangePercent:100*Math.abs(b-a)/((a+b)/2)};
  const p=(d+e)/2,pc=(c+f)/2;
  balancedAfterControl={pMean:p,pcMean:pc,changePercent:100*(pc/p-1),
    pairs:[{order:'PC/P',p:d,pc:c,changePercent:100*(c/d-1)},
      {order:'P/PC',p:e,pc:f,changePercent:100*(f/e-1)}]};
}
console.log(JSON.stringify({host,runs:runs.map(({trace,...r})=>r),comparisons,summary,
  sameArtifactControl,balancedAfterControl,
  pcChangePercent:summary.p&&summary.pc?100*(summary.pc.mean/summary.p.mean-1):null,
  timingEligible:!host.diagnostic&&!host.profile&&!host.clockAudit&&runs.every(r=>r.complete)&&comparisons.every(c=>c.pixels&&c.apis&&c.counters)
},null,2));
