#!/usr/bin/env node
'use strict';
// Function-level sampled wall attribution, never a substitute for CPU timing.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const [dirArg,nativeArg]=process.argv.slice(2);
assert(nativeArg,'PROFILE_DIRECTORY MATCHING_NATIVE_MAP_DIRECTORY');
const dir=path.resolve(dirArg),native=path.resolve(nativeArg);
const host=JSON.parse(fs.readFileSync(path.join(dir,'host.json')));
const result={};
for(const file of fs.readdirSync(dir).filter(f=>/^(p|pc)\d+\.cpuprofile$/.test(f))){
  const tag=file.replace(/\.cpuprofile$/,''),arm=tag.replace(/\d+$/,'');
  const mapDir=path.join(native,arm),capture=JSON.parse(fs.readFileSync(path.join(mapDir,'capture.json')));
  assert.equal(capture.wasmSha256,host.modules[arm],'function names must match exact measured module');
  const names=new Map(JSON.parse(fs.readFileSync(path.join(mapDir,'all-functions.json'))).map(f=>[f.index,f.name]));
  const raw=fs.readFileSync(path.join(dir,file)),profile=JSON.parse(raw);
  assert.equal(profile.samples.length,profile.timeDeltas.length);
  const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame]));
  const sums=new Map(),buckets={wasm:0,host:0,gc:0,idle:0,program:0};
  for(let i=0;i<profile.samples.length;i++){
    const f=nodes.get(profile.samples[i]),ms=profile.timeDeltas[i]/1000;
    const m=/wasm-function\[(\d+)\]/.exec(f.functionName);
    const isWasm=!!m||f.url.startsWith('wasm:');
    const name=m?(names.get(+m[1])||f.functionName):f.functionName||'(anonymous)';
    const bucket=isWasm?'wasm':name==='(garbage collector)'?'gc':name==='(idle)'?'idle':name==='(program)'?'program':'host';
    buckets[bucket]+=ms;
    const key=isWasm?name:name+' @ '+f.url;
    sums.set(key,(sums.get(key)||0)+ms);
  }
  const sampledMs=Object.values(buckets).reduce((a,b)=>a+b,0);
  result[tag]={sha256:crypto.createHash('sha256').update(raw).digest('hex'),sampledMs,
    buckets:Object.fromEntries(Object.entries(buckets).map(([k,ms])=>[k,{ms,percent:100*ms/sampledMs}])),
    top:[...sums].sort((a,b)=>b[1]-a[1]).map(([name,ms])=>({name,ms,percent:100*ms/sampledMs}))};
}
assert(Object.keys(result).length,'no profiles');
console.log(JSON.stringify(result,null,2));
