#!/usr/bin/env node
'use strict';

// Read-only inventory. Neither filenames nor an FPS-shaped number establish
// gameplay or a qualified counter. Run records remain assertions by their author.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReader, safeFile } = require('./readers');

const {inventory,readyApp,fixtureSummary} = require('./corpus-inventory');
const {classifyCandidate} = require('./corpus-categories');
const REVIEWED_SCENES = new Map([
  ['20261001-pirates-worker-castoff-before', ['final-sailing-before.png', 'final-sailing-after-turn.png']],
  ['20261001-pirates-worker-sailing-after', ['isolated-sailing-before.png', 'isolated-sailing-right.png', 'worker-stretch-isolated.png']],
  ['20261001T223000Z-serious-sam-demo-draw-trace', ['polling-forward.png', 'after-fire.png']],
]);


function classifyRun(run, raw, logicalEvidenceValid=false) {
  const declared = new Set([raw.screenshot, ...(raw.screenshots || [])].filter(v => typeof v === 'string'));
  const present = run.screenshots.filter(s => declared.has(s.name)).map(s => `${run.key}/${s.name}`);
  const reviewed = run.verification === 'reviewed';
  const pinned = REVIEWED_SCENES.get(run.id);
  // Scene names must be explicitly reviewed. A reviewed gameplay route may
  // also contain startup, setup, failure and game-over captures.
  const allowlist=Array.isArray(raw.gameplayScreenshots)?raw.gameplayScreenshots.filter(n=>typeof n==='string'):pinned||[];
  const images=reviewed?present.filter(p=>allowlist.includes(p.slice(run.key.length+1))):[];
  const p = run.performance;
  const logical=p?.metric==='guest-logical-frame-submissions'&&p.counterKind===p.metric&&p.qualification?.accepted===true&&reviewed&&images.length>0&&logicalEvidenceValid;
  return { key: run.key, route: run.route, outcome: run.outcome, verification: run.verification,
    startedAt: run.startedAt, summary: run.summary, build: run.build, environment: run.environment,
    screenshots: present, recordedReviewedGameplayScreenshots: images,
    sceneStatus: images.length ? 'recorded-reviewed-gameplay' : present.length ? 'scene-review-required' : 'no-declared-screenshot',
    performance: p ? { ...p, acceptance: logical ? 'reviewed-logical-frame-submissions' : p.counterKind === 'guest-flip-events' ? 'flip-events-not-gameplay-fps' : /(?:GDI|flush).*(?:proxy|event)|proxy.*(?:GDI|flush)/i.test(p.notes || '') ? 'gdi-flush-proxy-not-gameplay-fps' : 'counter-and-continuous-scene-review-required' } : null,
    acceptedLogicalFrameMeasurement:logical?{...p,physicalFps:null,evidenceValidation:'reviewed-receipts-and-raw-artifact-hashes-match'}:null,
    physicalFps:null,
    qualifiedGameplayFps: null,
  };
}

async function readJson(root, name, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(root,name), 'utf8')); }
  catch(e) { if(e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}

async function reviewScenes(root, filename) {
  if(!filename) return [];
  const data=await readJson(root,filename);
  if(!Array.isArray(data.reviews)) throw new Error('scene reviews must contain reviews array');
  return Promise.all(data.reviews.map(async review=>{
    const file=await safeFile(root,review.path);
    const sha256=file ? crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') : null;
    return {...review,validation:!file ? 'missing-or-unsafe' : sha256===review.sha256 ? 'hash-matched' : 'hash-mismatch',
      evidenceScope:'historical-scene-only; does not establish current compatibility, input response, or FPS'};
  }));
}

async function coverage(root, options={}) {
  root = path.resolve(root);
  const manifest = await readJson(root, 'test/candidate-corpus/manifest.json');
  const registry = require(path.join(root, 'lib/apps.js'));
  const assessments = await readJson(root, 'ops/corpus-status.json', {entries:[]});
  const snapshot = await createReader({root, codexRoot:false, claudeRoot:false}).snapshot();
  const entries = inventory(manifest, registry.APPS, assessments.entries,
    [...(registry.DESKTOP_APPS || []), ...(registry.LOCAL_CANDIDATE_APPS || []), ...(registry.DEBUG_ONLY_APPS || [])]);
  const sceneReviews=await reviewScenes(root,options.sceneReviews);
  const runData = await Promise.all(snapshot.runs.map(async run => {
    const raw = await readJson(root, `${run.key}/result.json`);
    const declared = [...new Set([raw.screenshot, ...(raw.screenshots || []), ...(raw.artifacts || []), ...(raw.diagrams || [])].filter(v=>typeof v==='string'))];
    const missingArtifacts = [];
    for(const name of declared) if(!await safeFile(path.join(root,run.key),name)) missingArtifacts.push(`${run.key}/${name}`);
    let logicalEvidenceValid=false;
    if(run.performance?.metric==='guest-logical-frame-submissions'){
      try{
        const dir=path.join(root,run.key),file=await safeFile(dir,run.performance.qualification.evidence);
        const q=file?JSON.parse(await fs.readFile(file,'utf8')):null;
        const checks=q?.accepted===true&&q.metric===run.performance.metric&&Array.isArray(q.samples)&&q.samples.length===run.performance.samples.length;
        if(checks){
          const proofs=[q.sceneReceipt,q.counterReceipt,...q.samples.map(s=>({path:s.raw,sha256:s.sha256}))];
          logicalEvidenceValid=true;
          for(const proof of proofs){const p=await safeFile(dir,proof?.path);if(!p||crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')!==proof.sha256)logicalEvidenceValid=false;}
          if(q.samples.some((s,i)=>s.evaluation?.accepted!==true||s.evaluation.frames!==run.performance.samples[i].frames||s.evaluation.durationMs!==run.performance.samples[i].durationMs))logicalEvidenceValid=false;
        }
      }catch{logicalEvidenceValid=false;}
    }
    return {...classifyRun(run,raw,logicalEvidenceValid), candidateId:run.candidateId, missingArtifacts};
  }));
  for (const c of entries) {
    c.category=classifyCandidate({...c,registryOnly:c.origin==='registry-only',executables:c.executablePaths});
    if(c.scope!=='noninteractive-demo') {
      if(['tools','graphics-demos'].includes(c.category.id)) c.scope='non-game';
      else if(c.category.id!=='unclassified') c.scope='game-or-game-package';
    }
    c.executablePresence = await Promise.all(c.executablePaths.map(async p=>({path:p,present:!!await safeFile(root,p)})));
    c.executableHintPresence = await Promise.all(c.executableHints.map(async p=>({path:p,present:!!await safeFile(root,p)})));
    for(const app of c.apps) {
      app.manifestStatus = 'not-used';
      if(app.localFileManifest) {
        const manifestPath=await safeFile(root,app.localFileManifest);
        if(!manifestPath) app.manifestStatus='missing-additional-dependencies-unknown';
        else {
          try {
            const media=JSON.parse(await fs.readFile(manifestPath,'utf8'));
            if(media.schemaVersion!==1 || !Array.isArray(media.files)) throw new Error('invalid schema');
            const base=new URL(app.localFileManifest,'http://fixture.invalid/');
            const files=media.files.map(f=>{
              if(typeof f?.url!=='string'||!f.url)throw new Error('invalid file URL');
              const url=new URL(f.url,base);
              if(url.origin!==base.origin)throw new Error('external media dependency requires separate verification');
              return decodeURIComponent(url.pathname).replace(/^\//,'');
            });
            app.dependencies=[...new Set([...app.dependencies,...files])];
            app.declaredPaths=[...new Set([...app.declaredPaths,...files])];
            app.manifestStatus='expanded';
          } catch(e) {app.manifestStatus='invalid-additional-dependencies-unknown';app.manifestError=e.message;}
        }
      }
      app.missingPaths = [];
      for(const p of app.dependencies) if(!await safeFile(root,p)) app.missingPaths.push(p);
      app.missingDeclaredPaths = [];
      for(const p of app.declaredPaths) if(!await safeFile(root,p)) app.missingDeclaredPaths.push(p);
      app.assetStatus = app.missingPaths.length ? 'missing-declared-assets' : 'declared-assets-present';
      app.routeCommand = `node test/run.js --app=${app.id} --quiet-api --max-seconds=120`;
      app.readiness = /unknown$/.test(app.manifestStatus) ? 'blocked-on-local-media-manifest' : app.missingPaths.length ? 'blocked-on-assets' : app.missingDeclaredPaths.length ? 'registry-path-repair-required' : 'route-and-runtime-review-required';
    }
    c.runs = runData.filter(r => r.candidateId === c.id || c.appIds.includes(r.candidateId));
    c.sceneReviews=sceneReviews.filter(r=>r.candidateId===c.id||c.appIds.includes(r.candidateId));
    Object.assign(c,fixtureSummary(c));
    c.missingArtifacts = [...new Set(c.runs.flatMap(r=>r.missingArtifacts))];
    c.screenshotStatus = c.sceneReviews.some(r=>r.validation==='hash-matched'&&r.sceneClass==='gameplay') ? 'hash-pinned-reviewed-gameplay-scene' : c.runs.some(r=>r.recordedReviewedGameplayScreenshots.length) ? 'recorded-reviewed-gameplay' : c.runs.some(r=>r.screenshots.length) ? 'scene-review-required' : 'missing';
    c.acceptedLogicalFrameMeasurement=c.runs.find(r=>r.acceptedLogicalFrameMeasurement)?.acceptedLogicalFrameMeasurement||null;
    c.physicalFps=null;
    c.fpsStatus = c.acceptedLogicalFrameMeasurement ? 'reviewed-logical-frame-submissions' : c.runs.some(r=>r.performance) ? 'unqualified-counter-evidence' : 'missing';
    c.next = c.scope === 'non-game' || c.scope === 'noninteractive-demo' ? 'Classify separately from playable games.' :
      c.apps.some(readyApp) ? 'Qualify input-driven gameplay with available declared assets; review scene and counter before measurement.' :
      c.missingPaths.length ? 'Restore exact listed fixture paths; existing screenshots remain historical evidence only.' : 'Review launch route, fixture mapping and game classification.';
  }
  const counts = {};
  for(const c of entries) for(const value of [`origin:${c.origin}`,`scope:${c.scope}`,`screenshots:${c.screenshotStatus}`,`fps:${c.fpsStatus}`]) counts[value]=(counts[value]||0)+1;
  return {schemaVersion:1,generatedAt:snapshot.generatedAt,root,
    semantics:'Union of manifest and all registered apps. Screenshot coverage requires explicit reviewed image names or hash-pinned scene reviews. Logical frame measurements require recorded independent qualification plus matching raw/review artifact hashes; physical displayed FPS stays unknown. Raw Flip events and GDI flush proxies remain unqualified.',
    sources:['test/candidate-corpus/manifest.json','lib/apps.js','ops/corpus-status.json','ops/corpus-categories.js','scratch/runs/*/result.json','ops/runs/*/result.json',...(options.sceneReviews?[options.sceneReviews]:[])],
    counts, readyAssetApps:entries.flatMap(c=>c.apps.filter(readyApp).map(a=>({candidateId:c.id,...a}))),
    unassociatedRuns:runData.filter(r=>!entries.some(c=>c.id===r.candidateId||c.appIds.includes(r.candidateId))),
    warnings:snapshot.warnings, entries};
}

if(require.main===module) {
  const args=process.argv.slice(2), root=args.find(a=>a.startsWith('--root='))?.slice(7)||path.join(__dirname,'..');
  const output=args.find(a=>a.startsWith('--output='))?.slice(9);
  const sceneReviews=args.find(a=>a.startsWith('--scene-reviews='))?.slice(16);
  coverage(root,{sceneReviews}).then(async result=>{
    const json=JSON.stringify(result,null,2)+'\n';
    if(output){await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await fs.writeFile(output,json);console.log(JSON.stringify({output,counts:result.counts,readyAssetApps:result.readyAssetApps.map(a=>a.id)},null,2));}
    else process.stdout.write(json);
  }).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
module.exports={inventory,classifyRun,coverage,reviewScenes};
