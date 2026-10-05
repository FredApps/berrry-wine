'use strict';
const assert=require('assert'),path=require('path'),{spawnSync}=require('child_process');
// Invalid secondary limits must fail before creating artifacts or a guest.
for(const value of ['0','-1','1.5','NaN','Infinity','9007199254740992']){
 const result=spawnSync(process.execPath,[path.join(__dirname,'../tools/black-white-software-probe.js'),
  `--max-batches=${value}`],{encoding:'utf8',timeout:10000});
 assert.ifError(result.error);
 assert.notStrictEqual(result.status,0);
 assert.match(result.stderr,/max-batches must be a positive safe integer/);
 assert(!result.stdout.includes('Artifacts:'),'validation precedes guest launch');
}
console.log('PASS Black & White probe rejects invalid batch guards before launch');
