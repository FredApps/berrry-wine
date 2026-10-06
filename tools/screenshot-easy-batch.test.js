'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert'),{spawnSync}=require('child_process');
const script=path.resolve('tools/screenshot-easy-batch.js'),root=fs.mkdtempSync(path.join(os.tmpdir(),'easy-shot-test-'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
try{
 fs.mkdirSync(root+'/build');fs.writeFileSync(root+'/build/wine-assembly.wasm','test fixture only');
 fs.writeFileSync(root+'/shot.png','fixture');fs.writeFileSync(root+'/run.json','{}');
 const review={entries:[{id:'fixture',path:'shot.png',sha256:sha('fixture'),sourceRun:'run.json',sourceRunSha256:sha('{}'),sceneClass:'gameplay',observation:'test only',reviewer:'fixture',reviewedAt:'2026-10-05'}]};
 fs.writeFileSync(root+'/review.json',JSON.stringify(review));
 let r=spawnSync(process.execPath,[script,'review','review.json','out.json'],{cwd:root});assert.equal(r.status,0,String(r.stderr));
 review.entries[0].sha256='0'.repeat(64);fs.writeFileSync(root+'/bad.json',JSON.stringify(review));r=spawnSync(process.execPath,[script,'review','bad.json','bad-out.json'],{cwd:root});assert.equal(r.status,1);assert(!fs.existsSync(root+'/bad-out.json'));
 const harness="const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});console.log(JSON.stringify({ready:true}));rl.on('line',l=>{if(JSON.parse(l).action==='quit'){fs.writeFileSync(process.argv[2]+'/cleanup.json',JSON.stringify({browserClosed:true,serverClosed:true}));rl.close();process.stdin.pause();}});";
 fs.writeFileSync(root+'/harness.js',harness);
 const plan={entries:['one','two'].map(n=>({taskId:'fixture-'+n,appId:n,runId:n,knownRouteEvidence:'fixture',harness:'harness.js',harnessSha256:sha(harness),deadlineMs:1000,outputDir:n,args:[n],commands:[],cleanupPath:n+'/cleanup.json'}))};
 fs.writeFileSync(root+'/plan.json',JSON.stringify(plan));r=spawnSync(process.execPath,[script,'capture','plan.json','capture.json','--slot-granted'],{cwd:root,timeout:5000});assert.equal(r.status,0,String(r.stderr));assert.equal(JSON.parse(fs.readFileSync(root+'/capture.json')).results.length,2);
 console.log('PASS reviewed hash acceptance, changed image rejection, serial pinned harness/cleanup; no browser launched');
}finally{fs.rmSync(root,{recursive:true,force:true});}
