'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {eligible,decide,message}=require('./work-watchdog');
const {workReady,workSubmitKey}=require('./work-guard');
const task={id:'GAME-A',owner:'codex:a',status:'active',dependencies:[],next:'verify gameplay'};
const terminal={id:'orchestrator',agentId:'codex:a',idle:true,screenHash:'one'};
const config={enabled:true,idleMs:120000,cooldownMs:900000,maxUnchangedNudges:2};
test('work eligibility respects ownership, dependencies, blockers, deferred tasks and exclusions',()=>{
  const tasks=[task,{...task,id:'blocked',blocker:'needs input'},{...task,id:'other',owner:'claude:b'},{...task,id:'deferred',status:'deferred'},{...task,id:'dependent',dependencies:['missing']},{...task,id:'exclude'}];
  assert.deepEqual(eligible(tasks,'codex:a',{excludedTasks:['exclude']}).map(t=>t.id),['GAME-A']);
});
test('requires stable idle, enforces cooldown, limits unchanged retries, and resets after task progress',()=>{
  const s={tasks:[task]};let d=decide(s,terminal,config,{},1000);assert.equal(d.send,false);
  d=decide(s,terminal,config,d.record,122000);assert.equal(d.send,true);
  d.record.lastNudgeAt=122000;d.record.attempts=1;
  assert.equal(decide(s,terminal,config,d.record,300000).record.reason,'cooldown');
  d.record.attempts=2;assert.match(decide(s,terminal,config,d.record,2000000).record.reason,/stalled/);
  assert.equal(decide({tasks:[{...task,next:'publish verified result'}]},terminal,config,d.record,2000000).record.attempts,0);
  assert.equal(decide(s,{...terminal,screenHash:'changed'},config,d.record,2000000).send,false);
});
test('pause, unavailable terminal and empty queue never send',()=>{
  for(const c of [{...config,paused:true},{...config,pausedTerminals:['orchestrator']},{...config,enabled:false}])assert.equal(decide({tasks:[task]},terminal,c,{},500000).send,false);
  assert.equal(decide({tasks:[task]},{...terminal,idle:false},config,{},500000).send,false);
  assert.equal(decide({tasks:[]},terminal,config,{},500000).send,false);
  assert.equal(decide({tasks:[task],agents:[{id:'codex:a',state:'tool'}]},terminal,config,{},500000).record.reason,'session has not reported an idle turn');
});
test('terminal guard refuses drafts, approvals, running turns and explicit user stops',()=>{
  const idle='Completed work.\n\n› Ask Codex to do anything\n\nGPT-6-Astra medium';
  assert.equal(workReady(idle,'codex'),true);
  assert.equal(workReady(idle.replace('Ask Codex to do anything','my draft'),'codex'),false);
  assert.equal(workReady('esc to interrupt\n'+idle,'codex'),false);
  assert.equal(workReady('› [Telegram] stop\n'+idle,'codex'),false);
  assert.equal(workReady('Would you like to run this command?\n'+idle,'codex'),false);
  assert.equal(workReady('Done\n❯ \n─────\n⏵⏵ bypass permissions on','claude'),true);
  assert.equal(workReady('Done\n❯ draft\n─────\n⏵⏵ bypass permissions on','claude'),false);
  assert.equal(workReady('Done\n❯ \n─────\n⏵⏵ bypass permissions on','unknown'),false);
});
test('Claude submission only confirms the exact watchdog draft',()=>{
  const text='[Work watchdog] Continue assigned tasks';
  assert.equal(workSubmitKey('❯ '+text+'\n─────\nbypass permissions on',text,'claude'),'Enter');
  assert.equal(workSubmitKey('❯ changed\n─────\nbypass permissions on',text,'claude'),null);
  assert.match(message([task],config),/Do not deploy publicly or answer approvals/);
});
