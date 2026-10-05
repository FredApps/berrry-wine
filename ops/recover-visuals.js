#!/usr/bin/env node
'use strict';
// Explicit reviewed mappings only. No filename guessing or transcript execution.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const REPORTED_BUILD_LIMITATION='Reported by the associated historical result; module bytes were not rehashed during recovery, and this is not current-build validation.';
function reportedBuild(root,entry){
  const e=entry.buildEvidence;
  if(e===undefined)return null;
  if(!e || typeof e.sourceResult!=='string' || !/^[a-f0-9]{64}$/.test(e.sourceResultSha256) ||
      !/^[a-f0-9]{64}$/.test(e.reportedWasmSha256) || typeof e.app!=='string' || !e.app.trim() ||
      !Number.isSafeInteger(e.sampleIndex) || e.sampleIndex<0 || typeof e.basis!=='string' || !e.basis.trim() ||
      e.limitation!==REPORTED_BUILD_LIMITATION)throw Error('Invalid reported build evidence');
  const source=path.resolve(root,entry.source),resultPath=path.resolve(root,e.sourceResult);
  if(path.basename(resultPath)!=='result.json' || path.dirname(resultPath)!==path.dirname(source) ||
      path.basename(source)!==`sample-${e.sampleIndex}-after.png`)throw Error('Build evidence capture identity mismatch');
  const bytes=fs.readFileSync(resultPath);
  if(sha(bytes)!==e.sourceResultSha256)throw Error('Build evidence source result changed');
  const result=JSON.parse(bytes.toString('utf8'));
  if(result.app!==e.app || result.wasmSha256!==e.reportedWasmSha256 ||
      !Number.isSafeInteger(result.samples) || result.samples<=e.sampleIndex ||
      !Array.isArray(result.results) || !result.results[e.sampleIndex])throw Error('Build evidence result identity mismatch');
  return e.reportedWasmSha256;
}
// Explicit root injection is for disposable-fixture validation. The CLI keeps
// the existing repository root and existing-result skip behavior.
function recover(root=path.resolve(__dirname,'..')){
const candidates=new Set(JSON.parse(fs.readFileSync(path.join(root,'test/candidate-corpus/manifest.json'),'utf8')).candidates.map(c=>c.id));
const registryPath=path.join(root,'lib/apps.js');
if(fs.existsSync(registryPath)) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'test/candidate-corpus/manifest.json'),'utf8'));
  const statusPath=path.join(root,'ops/corpus-status.json');
  const assessments=fs.existsSync(statusPath)?JSON.parse(fs.readFileSync(statusPath,'utf8')).entries || []:[];
  for(const entry of require('./corpus-inventory').inventory(manifest,require(registryPath).APPS,assessments))candidates.add(entry.id);
}
const entries=JSON.parse(fs.readFileSync(path.join(root,'ops/historical-visuals.json'),'utf8'));
const report=[];
for(const entry of entries){
  if(!candidates.has(entry.candidateId) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !entry.evidence?.length || !Number.isFinite(Date.parse(entry.sourceModifiedAt)))throw Error('Invalid reviewed mapping');
  const directory=path.join(root,'scratch/runs','recovered-'+entry.candidateId+'-'+entry.sha256.slice(0,16));
  if(fs.existsSync(path.join(directory,'result.json'))){report.push({candidateId:entry.candidateId,status:'already imported'});continue;}
  const source=path.resolve(root,entry.source);
  if(!fs.existsSync(source)){report.push({candidateId:entry.candidateId,status:'source unavailable',source});continue;}
  const bytes=fs.readFileSync(source);
  if(sha(bytes)!==entry.sha256)throw Error('Source changed: '+source);
  const wasmSha256=reportedBuild(root,entry);
  if(entry.associationReview!==undefined && (typeof entry.associationReview!=='string' || !entry.associationReview.trim()))throw Error('Invalid association review');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'screen.png'),bytes);
  const importedAt=new Date().toISOString();
  fs.writeFileSync(path.join(directory,'provenance.json'),JSON.stringify({...entry,importedAt,associationReview:entry.associationReview || 'Exact source test/log and displayed content reviewed; this is not current-build validation.'},null,2)+'\n');
  const result={candidateId:entry.candidateId,startedAt:entry.sourceModifiedAt,outcome:'unknown',verification:'unreviewed',
    route:'Historical capture / '+entry.scene,summary:entry.summary+' Historical image only; no current compatibility or performance result. Date is original file mtime, not a verified capture time.',
    command:'Unknown; see provenance evidence',build:{commit:null,wasmSha256},screenshots:['screen.png'],artifacts:['provenance.json'],importedAt};
  fs.writeFileSync(path.join(directory,'result.json.tmp'),JSON.stringify(result,null,2)+'\n');
  fs.renameSync(path.join(directory,'result.json.tmp'),path.join(directory,'result.json'));
  report.push({candidateId:entry.candidateId,status:'imported',directory:path.relative(root,directory)});
}
fs.mkdirSync(path.join(root,'scratch/ops-backfill'),{recursive:true});
fs.writeFileSync(path.join(root,'scratch/ops-backfill/recovery-report.json'),JSON.stringify({at:new Date().toISOString(),entries:report},null,2)+'\n');
return report;
}
if(require.main===module)console.log(JSON.stringify(recover(),null,2));
module.exports={recover,REPORTED_BUILD_LIMITATION};
