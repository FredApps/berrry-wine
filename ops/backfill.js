#!/usr/bin/env node
'use strict';

// Offline historical evidence importer. Never executes transcript commands.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'scratch/ops-backfill');
const inventoryFile = path.join(reportDir, 'inventory.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const candidates = require('../test/candidate-corpus/manifest.json').candidates;
const { APPS } = require('../lib/apps');
const aliases = new Map(candidates.map(c => [c.id, c.id]));
for (const [id, app] of Object.entries(APPS)) {
  const candidate = candidates.find(c => (app.exe || '').includes('/candidates/' + c.id + '/'));
  if (candidate) aliases.set(id, candidate.id);
}
function identify(file) {
  // Candidate names can be ordinary prose ("generally"). Only complete path
  // components or image stems count, never words anywhere in tool arguments.
  const parts = file.split('/');
  if (parts.length < 2 || /[\n\r]/.test(file)) return null;
  parts[parts.length - 1] = parts.at(-1).replace(/\.(png|jpe?g|webp)$/i, '');
  const found = new Set(parts.map(p=>aliases.get(p)).filter(Boolean));
  return found.size === 1 ? [...found][0] : null;
}
function* walk(dir) {
  let entries; try { entries = fs.readdirSync(dir, {withFileTypes:true}); } catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile()) yield file;
  }
}
function head(file) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(16384); const n = fs.readSync(fd,b,0,b.length,0); return b.subarray(0,n).toString(); }
  finally { fs.closeSync(fd); }
}
function imagePaths(text) {
  // Literal paths only: variables/globs/templates are never expanded or executed.
  return [...text.matchAll(/(?:\/(?:Users|private|tmp)\/|(?:build|scratch)\/)[^\s"'`<>;|(){}\[\]\\]*?\.(?:png|jpe?g|webp)\b/gi)]
    .map(m => path.resolve(root,m[0])).filter(p => !/[\$*]/.test(p));
}
async function inventory(codexOnly = false) {
  const previous = codexOnly && fs.existsSync(inventoryFile) ? JSON.parse(fs.readFileSync(inventoryFile)) : null;
  const images = new Map((previous?.images || []).map(item=>[item.path,item]));
  function add(file, reference) {
    if (!(file.startsWith(root + '/') || file.startsWith('/tmp/') || file.startsWith('/private/tmp/'))) return;
    if (file.includes('/scratch/runs/') || file.includes('/ops-backfill/') || file.includes('/ops-preview/') || file.includes('/ops-import/')) return;
    if (!images.has(file)) images.set(file,{path:file, candidateId:identify(file), references:[]});
    const item = images.get(file);
    if (reference && item.references.length < 20 && !item.references.some(r=>r.agentId===reference.agentId && r.at===reference.at)) item.references.push(reference);
  }
  for (const directory of ['build','scratch']) for (const file of walk(path.join(root,directory))) if (/\.(png|jpe?g|webp)$/i.test(file)) add(file);
  const logs = [];
  for (const dir of ['sessions','archived_sessions']) for (const file of walk(path.join(os.homedir(),'.codex',dir))) {
    if (!file.endsWith('.jsonl')) continue;
    const prefix=head(file);
    let cwd; try { cwd=JSON.parse(prefix.match(/"cwd"\s*:\s*("(?:\\.|[^"\\])*")/)?.[1] || 'null'); } catch { continue; }
    if (prefix.includes('"session_meta"') && (cwd===root || cwd?.startsWith(root+'/'))) logs.push({file,provider:'codex'});
  }
  const claude = path.join(os.homedir(),'.claude/projects',root.replace(/[^a-zA-Z0-9]/g,'-'));
  if (!codexOnly) for (const file of walk(claude)) if (file.endsWith('.jsonl')) logs.push({file,provider:'claude'});
  let scanned = 0;
  for (const {file,provider} of logs) {
    let session = path.basename(file,'.jsonl');
    if (provider === 'codex') session = session.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)?.[0];
    if (!session) continue;
    const lines = readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
    let lineNo = 0;
    for await (const line of lines) {
      lineNo++;
      if (!/\.(png|jpe?g|webp)/i.test(line)) continue;
      let row; try { row=JSON.parse(line); } catch { continue; }
      let inputs=[];
      if (provider==='codex' && row.type==='response_item' && ['function_call','custom_tool_call'].includes(row.payload?.type)) inputs=[row.payload.arguments || row.payload.input || ''];
      if (provider==='claude' && row.type==='assistant') inputs=(row.message?.content || []).filter(c=>c.type==='tool_use').map(c=>JSON.stringify(c.input));
      for (const input of inputs) {
        if (typeof input !== 'string' || input.includes('ops/backfill') || input.includes('ops-import/')) continue;
        const candidateId=null;
        for (const image of imagePaths(input)) add(image,{agentId:provider+':'+session,at:row.timestamp || null,sourceLog:file,line:lineNo,candidateId,
          relation:'referenced by tool input; authorship and capture time unverified'});
      }
    }
    if (++scanned % 50 === 0) console.log(`Scanned ${scanned}/${logs.length} project logs; ${images.size} image paths`);
  }
  for (const item of images.values()) {
    item.candidateId=identify(item.path);
    item.mappingBasis=item.candidateId ? 'exact candidate or registered app ID path component' : null;
  }
  const data={scannedAt:new Date().toISOString(),logs:logs.length+(previous?.logs || 0),images:[...images.values()]};
  fs.mkdirSync(reportDir,{recursive:true});
  fs.writeFileSync(inventoryFile,JSON.stringify(data,null,2)+'\n');
  console.log(`Inventory saved: ${logs.length} logs, ${images.size} image paths`);
}
function publish() {
  const inventory=JSON.parse(fs.readFileSync(inventoryFile));
  const existing=new Set();
  for(const dir of ['scratch/runs','ops/runs']) for(const file of walk(path.join(root,dir))) if(/\.(png|jpe?g|webp)$/i.test(file)) existing.add(sha(fs.readFileSync(file)));
  const report={importedAt:new Date().toISOString(),inventoryAt:inventory.scannedAt,logs:inventory.logs,imported:[],skipped:[]};
  for(const item of inventory.images) {
    // Revalidate old inventories too; never trust an earlier inferred mapping.
    item.candidateId=identify(item.path);
    item.mappingBasis=item.candidateId ? 'exact candidate or registered app ID path component' : null;
    const skip=reason=>report.skipped.push({path:item.path,candidateId:item.candidateId,reason});
    if (/(?:\/icons\/|\/node_modules\/|\/test\/binaries\/)/.test(item.path)) {skip('application asset rather than captured evidence');continue;}
    if(!item.candidateId) { skip('candidate association ambiguous or absent'); continue; }
    let stat,bytes;
    try {
      stat=fs.statSync(item.path);
      if(!stat.isFile() || stat.size>32*1024*1024) { skip('not a regular image under 32 MiB'); continue; }
      if(Date.now()-stat.mtimeMs<120000) { skip('recently modified; may still be written'); continue; }
      bytes=fs.readFileSync(item.path);
      const after=fs.statSync(item.path);
      if(after.size!==stat.size || after.mtimeMs!==stat.mtimeMs) {skip('changed while reading');continue;}
    } catch {skip('source missing or unreadable');continue;}
    const digest=sha(bytes);
    if(existing.has(digest)) {skip('duplicate image content already published');continue;}
    let dimensions=null;
    if(/\.png$/i.test(item.path)) {
      try {
        if(bytes.length<24 || bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16000000) {skip('oversize or malformed PNG');continue;}
        const png=PNG.sync.read(bytes); dimensions={width:png.width,height:png.height};
        if(png.width<160 || png.height<100) {skip('small crop or asset, not a dashboard capture');continue;}
        let visible=0;
        for(let i=0;i<png.data.length;i+=4) if(png.data[i+3]>16 && Math.max(png.data[i],png.data[i+1],png.data[i+2])>16) visible++;
        if(visible/(png.width*png.height)<0.005) {skip('near-black or transparent capture (<0.5% visible pixels); retained at source');continue;}
      } catch {skip('invalid PNG');continue;}
    }
    const id='history-'+item.candidateId+'-'+digest.slice(0,16);
    const dir=path.join(root,'scratch/runs',id);
    if(fs.existsSync(dir)) {skip('deterministic bundle already exists');continue;}
    fs.mkdirSync(dir,{recursive:true});
    const name='screen'+path.extname(item.path).toLowerCase();
    fs.writeFileSync(path.join(dir,name),bytes,{flag:'wx'});
    const agents=[...new Set(item.references.map(r=>r.agentId))];
    const provenance={...item,sha256:digest,bytes:bytes.length,dimensions,sourceFileModifiedAt:stat.mtime.toISOString(),importedAt:report.importedAt,
      timestampBasis:'source file modification time, not verified execution/capture time',
      note:'Historical artifact copied unchanged. Tool references establish related sessions only, not authorship. No transcript content or commands copied; build/outcome unknown.'};
    fs.writeFileSync(path.join(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
    const result={candidateId:item.candidateId,agentId:agents.length===1?agents[0]:null,startedAt:stat.mtime.toISOString(),outcome:'unknown',verification:'unreviewed',
      route:'historical artifact / '+path.basename(item.path),command:'unknown; see provenance references',build:{commit:null,wasmSha256:null},
      summary:'Historical import, not a compatibility pass. Date is source file mtime; capture time unverified. '+(agents.length===1?'Linked session referenced this path; authorship unverified.':'Session association absent or ambiguous. '),
      screenshots:[name],artifacts:['provenance.json'],importedAt:report.importedAt};
    if(/(?:diagram|architecture|flowchart)/i.test(path.basename(item.path))) {result.diagrams=result.screenshots;delete result.screenshots;}
    fs.writeFileSync(path.join(dir,'result.json.tmp'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    fs.renameSync(path.join(dir,'result.json.tmp'),path.join(dir,'result.json'));
    existing.add(digest);report.imported.push({id,candidateId:item.candidateId,agentId:result.agentId,source:item.path,bytes:bytes.length});
  }
  const file=path.join(reportDir,'report-'+report.importedAt.replace(/[:.]/g,'-')+'.json');
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:file,imported:report.imported.length,candidates:new Set(report.imported.map(r=>r.candidateId)).size,bytes:report.imported.reduce((n,r)=>n+r.bytes,0),skipped:report.skipped.reduce((o,r)=>(o[r.reason]=(o[r.reason]||0)+1,o),{})},null,2));
}
function audit() {
  const report={auditedAt:new Date().toISOString(),kept:[],quarantined:[]};
  const runs=path.join(root,'scratch/runs');
  for (const entry of fs.readdirSync(runs,{withFileTypes:true})) {
    if(!entry.isDirectory() || !entry.name.startsWith('history-')) continue;
    const dir=path.join(runs,entry.name);
    const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));
    const provenance=JSON.parse(fs.readFileSync(path.join(dir,'provenance.json')));
    if(identify(provenance.path)===result.candidateId) {
      provenance.mappingBasis='exact candidate or registered app ID path component';
      fs.writeFileSync(path.join(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
      report.kept.push(entry.name);
    } else {
      const target=path.join(reportDir,'quarantine',entry.name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      if(fs.existsSync(target)) throw Error('Quarantine destination exists: '+target);
      fs.renameSync(dir,target);
      report.quarantined.push({id:entry.name,candidateId:result.candidateId,source:provenance.path,reason:'Candidate association was inferred from tool text; no exact image path association'});
    }
  }
  fs.writeFileSync(path.join(reportDir,'association-audit.json'),JSON.stringify(report,null,2)+'\n');
  console.log({kept:report.kept.length,quarantined:report.quarantined.length,report:'scratch/ops-backfill/association-audit.json'});
}
if(require.main===module) {
  const mode=process.argv[2];
  if(mode==='--scan' || mode==='--scan-codex') inventory(mode==='--scan-codex').catch(e=>{console.error(e);process.exitCode=1;});
  else if(mode==='--publish') publish();
  else if(mode==='--audit') audit();
  else console.log('Usage: node ops/backfill.js --scan | --publish | --audit\nScan project session references and local images, then publish path-associated historical bundles. Audit quarantines unsafe older imports, preserving their files. Reports stay in scratch/ops-backfill.');
}
module.exports={identify,imagePaths};
