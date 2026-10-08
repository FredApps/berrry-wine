'use strict';
// Real HTTP over the unchanged strict asset handler, backed by authenticated
// archive members in memory. Avoid another physical source/fixture copy.
const fs=require('fs'),http=require('http'),crypto=require('crypto'),zlib=require('zlib'),vm=require('vm'),path=require('path'),{Readable}=require('stream');
const {tarFiles}=require('./antara-win16-callback-prepare');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function preflight(dir){
 const plan=JSON.parse(fs.readFileSync(dir+'/browser-pins9.json')),pins=JSON.parse(fs.readFileSync(dir+'/transfer-files.json')),members=tarFiles(zlib.gunzipSync(fs.readFileSync(dir+'/payload.tar.gz'))),bytes=new Map();
 const prefix=JSON.parse(fs.readFileSync(dir+'/READY.json')).remotePrefix;
 for(const p of pins){const rel=p.remote.slice((prefix+'/').length),local=dir+'/'+rel;const b=fs.existsSync(local)?fs.readFileSync(local):members.get('antara-client-origin-20261008/'+rel);if(!b||b.length!==p.bytes||sha(b)!==p.sha256)throw Error('final pin '+rel);bytes.set(p.remote,b);}
 const memoryFS={existsSync:p=>bytes.has(p),statSync(p){const b=bytes.get(p);if(!b)throw Error('unmapped pinned path '+p);return{size:b.length,isFile:()=>true};},createReadStream(p,{start,end}){return Readable.from([bytes.get(p).subarray(start,end+1)]);}};
 const m={exports:{}};vm.runInNewContext(fs.readFileSync(dir+'/assets.js','utf8'),{module:m,require:n=>n==='node:fs'?memoryFS:require(n),URL,setTimeout,clearTimeout,console});
 const responses=[],errors=[],pending=new Set(),root=plan.sourceRoot,fixtureRoot=plan.fixtureRoot;
 function requestFile(url,r,f){const rel=decodeURIComponent(new URL(url,'http://local').pathname).slice(1)||'index.html';if(rel.split('/').some(p=>p==='..'||p.includes('\\')))throw Error('path');return{rel,p:plan.sourceOverrides[rel]||(rel.startsWith('test/binaries/')?f:r)+'/'+rel};}
 function rangeFor(value,size){if(!value)return{start:0,end:size-1,status:200};const m=/^bytes=(\d+)-(\d*)$/.exec(value);if(!m)throw Error('range');const start=+m[1],end=m[2]?+m[2]:size-1;if(start<0||end<start||end>=size)throw Error('range bounds');return{start,end,status:206};}
 const server=http.createServer(m.exports.createAssetHandler({plan,root,fixtureRoot,responses,errors,pending,requestFile,rangeFor}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';
 async function req(rel,method='GET',headers={}){const res=await fetch(base+rel,{method,headers});const b=Buffer.from(await res.arrayBuffer());return{status:res.status,bytes:b.length,sha256:sha(b)};}
 try{
  let heads=0;for(const rel of [...Object.keys(plan.sourceHashes),...plan.fixtures.map(f=>f.path),...Object.keys(plan.aliases)]){const r=await req(rel,'HEAD');if(r.status!==200||r.bytes!==0)throw Error('HEAD '+rel);heads++;}
  const paths=['build/wine-assembly.wasm','lib/guest-worker.js','lib/guest-thread-host.js','lib/apps.js',plan.criticalFiles.find(f=>/\/SETUP\.EXE$/i.test(f.path)).path],gets=[];
  for(const rel of paths){const r=await req(rel);const expected=plan.sourceHashes[rel]||plan.criticalFiles.find(f=>f.path===rel).sha256;if(r.status!==200||r.sha256!==expected)throw Error('GET '+rel);gets.push({path:rel,...r});}
  const rel='lib/guest-worker.js',range=await req(rel,'GET',{Range:'bytes=0-63'});if(range.status!==206||range.bytes!==64||range.sha256!==sha(bytes.get(plan.sourceOverrides[rel]).subarray(0,64)))throw Error('range');
  const negative=plan.optionalNegativeProbes[0],absent=await req(negative.url);if(absent.status!==404)throw Error('optional absent');
  const drained=await m.exports.drainStreams(pending,500);if(drained.pending||errors.length)throw Error(JSON.stringify({drained,errors}));
  const result={at:new Date().toISOString(),scope:'real HTTP strict handler; in-memory filesystem of authenticated archive/overlay bytes; no browser or guest execution',pins:pins.length,heads,gets,range,optionalAbsent:negative.url,drained,errors};
  fs.writeFileSync(dir+'/preflight.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));return result;
 }finally{await new Promise(r=>server.close(r));}
}
if(require.main===module)preflight(path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={preflight};
