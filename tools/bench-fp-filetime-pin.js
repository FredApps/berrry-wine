'use strict';
// Diagnostic/benchmark-only preload: deterministic virtual file metadata.
// Does not override the process clock or guest timing APIs. No WASM edits.
const fs=require('fs'),Module=require('module'),assert=require('assert');
const old=Module._extensions['.js'];
if(process.env.FP_CLOCK_AUDIT){
  global.__fpClockAudit={};
  process.on('exit',()=>process.stderr.write('[fp-calendar] '+JSON.stringify(global.__fpClockAudit)+'\n'));
}
Module._extensions['.js']=function(module,file){
  if(process.env.FP_FILETIME_EPOCH && /[/\\]lib[/\\]filesystem\.js$/.test(file)){
    const epoch=Number(process.env.FP_FILETIME_EPOCH);assert(Number.isSafeInteger(epoch)&&epoch>0);
    const s=fs.readFileSync(file,'utf8'),needle='BigInt(Date.now()) * 10000n';
    assert.equal(s.split(needle).length,2,'unique virtual file-time seam');
    module._compile(s.replace(needle,`BigInt(${epoch}) * 10000n`),file);
  }else if(process.env.FP_SHARE_CALENDAR && /[/\\]lib[/\\]worker-imports\.js$/.test(file)){
    const s=fs.readFileSync(file,'utf8'),needle="  'guestNowMs',";
    assert.equal(s.split(needle).length,2,'unique shared guest clock seam');
    module._compile(s.replace(needle,"  'wallNowMs',\n"+needle),file);
  }else if(process.env.FP_CLOCK_AUDIT && /[/\\]lib[/\\]host-imports\.js$/.test(file)){
    const s=fs.readFileSync(file,'utf8'),needle='const now = ctx.wallNowMs ? ctx.wallNowMs() : Date.now();';
    assert.equal(s.split(needle).length,2,'unique calendar import seam');
    module._compile(s.replace(needle,needle+`
      const bucket=ctx.wallNowMs?'shared':'fallback';
      const audit=global.__fpClockAudit[bucket] ||= {calls:0,first:[]};
      audit.calls++;if(audit.first.length<4)audit.first.push({now,kind});
    `),file);
  }else old(module,file);
};
