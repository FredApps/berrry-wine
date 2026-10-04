'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inventory,classifyRun,reviewScenes,coverage}=require('./gameplay-coverage');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

test('union preserves registry-only titles, maps exact executable aliases and retains missing declared paths',()=>{
  const rows=inventory({candidates:[{id:'game-demo',name:'Game',kind:'installer',executables:['game.exe']} ]},
    {installed:{exe:'binaries/candidates/game-demo/game.exe',files:[{url:'binaries/candidates/game-demo/data.bin'}]},
      wep:{exe:'binaries/wep/game.exe'},debug:{exe:'binaries/debug.exe'}},[],[['wep','WEP Game']]);
  assert.equal(rows.length,3);
  assert.deepEqual(rows.find(c=>c.id==='game-demo').appIds,['installed']);
  assert.equal(rows.find(c=>c.id==='wep').name,'WEP Game');
  assert.equal(rows.find(c=>c.id==='wep').scope,'classification-required');
  assert.deepEqual(rows.find(c=>c.id==='wep').apps[0].declaredPaths,['binaries/wep/game.exe']);
  assert.deepEqual(rows.find(c=>c.id==='wep').apps[0].dependencies,['test/binaries/wep/game.exe']);
});

test('registered executable replaces alternate discovery hints without dropping real dependencies',()=>{
  const [row]=inventory({candidates:[{id:'demo',executables:['setup.exe','other/game.exe']}]},
    {installed:{exe:'test/binaries/candidates/demo/installed/game.exe',dlls:['test/binaries/candidates/demo/engine.dll'],files:['test/binaries/candidates/demo/data.bin']}},
    [{id:'demo',appIds:['installed']}]);
  assert.deepEqual(row.executablePaths,['test/binaries/candidates/demo/installed/game.exe']);
  assert.deepEqual(row.executableHints,['test/binaries/candidates/demo/setup.exe','test/binaries/candidates/demo/other/game.exe']);
  assert.equal(row.apps[0].dependencies.length,3);
});

test('real media dependencies block readiness while missing alternative EXE hints do not',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fixture-coverage-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const put=async(p,data)=>{await fs.mkdir(path.dirname(path.join(root,p)),{recursive:true});await fs.writeFile(path.join(root,p),data);};
  await put('test/candidate-corpus/manifest.json',JSON.stringify({candidates:[{id:'demo',executables:['setup.exe','game.exe']}]}));
  await put('ops/corpus-status.json',JSON.stringify({entries:[{id:'demo',appIds:['installed']}]}));
  await put('lib/apps.js',`module.exports={APPS:{installed:{exe:'test/binaries/candidates/demo/installed.exe',files:['test/binaries/candidates/demo/data.bin'],localFileManifest:'test/binaries/candidates/demo/media.json'}}};`);
  await put('test/binaries/candidates/demo/installed.exe','exe');
  const media='test/binaries/candidates/demo/media.json';
  await put(media,JSON.stringify({schemaVersion:1,files:[{url:'sound%20track.bin'}]}));
  let result=await coverage(root);
  assert.equal(result.readyAssetApps.length,0);
  assert.deepEqual(result.entries[0].missingPaths.sort(),['test/binaries/candidates/demo/data.bin','test/binaries/candidates/demo/sound track.bin']);
  await put('test/binaries/candidates/demo/data.bin','data');
  await put('test/binaries/candidates/demo/sound track.bin','audio');
  result=await coverage(root);
  assert.equal(result.readyAssetApps.length,1);
  assert.deepEqual(result.entries[0].missingPaths,[]);
  assert.equal(result.entries[0].executableHintPresence.filter(e=>!e.present).length,2);
  await put(media,JSON.stringify({schemaVersion:1,files:[{}]}));
  result=await coverage(root);
  assert.equal(result.readyAssetApps.length,0);
  assert.equal(result.entries[0].apps[0].readiness,'blocked-on-local-media-manifest');
  await fs.unlink(path.join(root,media));
  result=await coverage(root);
  assert.equal(result.readyAssetApps.length,0);
  assert.ok(result.entries[0].missingPaths.includes(media));
});

function run(overrides={}) {return {id:'test',key:'scratch/runs/test',route:'gameplay',verification:'reviewed',screenshots:[{name:'gameplay.png'},{name:'main-menu.png'},{name:'extra.png'}],...overrides};}
test('menu, intro, unreviewed and undeclared images cannot become reviewed gameplay coverage',()=>{
  const raw={screenshots:['gameplay.png','main-menu.png'],gameplayScreenshots:['gameplay.png']};
  assert.deepEqual(classifyRun(run(),raw).recordedReviewedGameplayScreenshots,['scratch/runs/test/gameplay.png']);
  assert.deepEqual(classifyRun(run({route:'intro-to-menu'}),{screenshots:raw.screenshots}).recordedReviewedGameplayScreenshots,[]);
  assert.deepEqual(classifyRun(run({verification:'unreviewed'}),raw).recordedReviewedGameplayScreenshots,[]);
  assert.deepEqual(classifyRun(run({screenshots:[]}),raw).recordedReviewedGameplayScreenshots,[]);
});

test('reviewed gameplay route alone never promotes setup, startup, or failure screenshots',()=>{
  const images=['startup.png','setup.png','error.png'];
  for(const outcome of ['passed','failed']){
    const result=classifyRun(run({outcome,route:'gameplay: attempted input',screenshots:images.map(name=>({name}))}),{screenshots:images});
    assert.deepEqual(result.recordedReviewedGameplayScreenshots,[]);
  }
  const explicit=classifyRun(run({screenshots:[{name:'startup.png'},{name:'gameplay.png'}]}),{screenshots:['startup.png','gameplay.png'],gameplayScreenshots:['gameplay.png']});
  assert.deepEqual(explicit.recordedReviewedGameplayScreenshots,['scratch/runs/test/gameplay.png']);
});

test('Flip events and ordinary performance metadata cannot silently become qualified gameplay FPS',()=>{
  for(const counterKind of ['guest-flip-events',undefined]) {
    const result=classifyRun(run({performance:{fps:0,counterKind,samples:[{frames:0,durationMs:1000}]}}),{screenshot:'gameplay.png'});
    assert.equal(result.qualifiedGameplayFps,null);
    assert.equal(result.performance.fps,0);
    assert.match(result.performance.acceptance,counterKind ? /not-gameplay-fps/ : /review-required/);
  }
});

test('fresh GDI flush proxy remains counter evidence, not unique gameplay FPS',()=>{
  const result=classifyRun(run({performance:{fps:26.4,historical:false,notes:'GDI surface-flush proxy; not unique logical/displayed FPS'}}),{screenshot:'gameplay.png'});
  assert.equal(result.performance.acceptance,'gdi-flush-proxy-not-gameplay-fps');
  assert.equal(result.performance.historical,false);
  assert.equal(result.qualifiedGameplayFps,null);
});

test('logical qualification additionally requires validated evidence and explicit scene images; physical FPS remains unknown',()=>{
  const r=run({performance:{metric:'guest-logical-frame-submissions',counterKind:'guest-logical-frame-submissions',fps:30,qualification:{accepted:true}}});
  const raw={screenshot:'gameplay.png',gameplayScreenshots:['gameplay.png']};
  assert.equal(classifyRun(r,raw).acceptedLogicalFrameMeasurement,null);
  assert.equal(classifyRun(r,{screenshot:'gameplay.png'},true).acceptedLogicalFrameMeasurement,null);
  const accepted=classifyRun(r,raw,true);
  assert.equal(accepted.acceptedLogicalFrameMeasurement.fps,30);
  assert.equal(accepted.physicalFps,null);
});

test('external scene review needs matching bytes and cannot traverse out of root',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scene-review-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bytes=Buffer.from('test artifact'), sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(root,'scene.png'),bytes);
  await fs.writeFile(path.join(root,'reviews.json'),JSON.stringify({reviews:[
    {candidateId:'game',path:'scene.png',sha256,sceneClass:'gameplay'},
    {candidateId:'game',path:'scene.png',sha256:'wrong',sceneClass:'gameplay'},
    {candidateId:'game',path:'../outside.png',sha256,sceneClass:'gameplay'},
  ]}));
  const result=await reviewScenes(root,'reviews.json');
  assert.deepEqual(result.map(r=>r.validation),['hash-matched','hash-mismatch','missing-or-unsafe']);
  assert.match(result[0].evidenceScope,/does not establish current compatibility/);
});
