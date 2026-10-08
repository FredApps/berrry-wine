'use strict';
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process'),path=require('path');
const dir=process.argv[2],prefix=process.argv[3];
assert(dir&&prefix,'prepared directory and expected prefix required');
const invalid=cp.spawnSync(process.execPath,[path.join(__dirname,'../tools/tiberian-original-prepare.js'),dir,'/home/user/../shared'],{encoding:'utf8'});
assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/usage:/);
for(const n of ['browser-pins.json','serve-plan.json','transfer-files.json','transfer.js','control.js']){
 const text=fs.readFileSync(path.join(dir,n),'utf8');
 assert(!text.includes('/home/user/tiberian-release-20261008'),n+' stale baseline prefix');
 assert(!text.includes('/home/user/tiberian-original-20261008'),n+' stale original prefix');
 assert(text.includes(prefix),n+' expected prefix');
}
const files=JSON.parse(fs.readFileSync(path.join(dir,'transfer-files.json')));
for(const f of files)assert(f.remote.startsWith(prefix+'/'),f.remote);
const transfer=fs.readFileSync(path.join(dir,'transfer.js'),'utf8');
assert(!transfer.includes('--unlink-first'));assert(transfer.includes('"--strip-components=1"'));assert(transfer.includes('"fresh prefix required"'));
console.log('PASS invalid prefix rejected before preparation; all runtime/control paths use fresh prefix; normal baseline/overlay extraction');
