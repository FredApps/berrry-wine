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
  assert.ok(message(Array.from({length:20},()=>({...task,id:'A'.repeat(150)})),config).length<600);
});
test('a short owner id (first UUID group) owns the same tasks as the full session id',()=>{
  const full='claude:d10ba697-f69c-4855-aeff-e6a61b6e2735';
  const tasks=[{...task,id:'SHORT',owner:'claude:d10ba697'},{...task,id:'FULL',owner:full},{...task,id:'OTHER',owner:'claude:d10ba69'}];
  assert.deepEqual(eligible(tasks,full).map(t=>t.id),['FULL','SHORT']);
});
test('workers idle without owned tasks are reported to the dispatcher, not nudged themselves',()=>{
  const {unassigned,dispatch,dispatchMessage}=require('./work-watchdog');
  const c={...config,dispatcher:'orchestrator',terminals:['orchestrator','w1','w2'],unassignedMs:600000};
  const snap={tasks:[{...task,owner:'claude:w2'}],agents:[{id:'claude:w1',state:'idle'},{id:'claude:w2',state:'idle'},{id:'claude:o',state:'idle'}]};
  const w1={id:'w1',agentId:'claude:w1',idle:true},w2={id:'w2',agentId:'claude:w2',idle:true},o={id:'orchestrator',agentId:'claude:o',idle:true,screenHash:'h'};
  assert.equal(unassigned(snap,w1,c,{},1000),1000);
  assert.equal(unassigned(snap,w1,c,{unassignedSince:500},1000),500);
  assert.equal(unassigned(snap,w2,c,{},1000),null,'owns a task');
  assert.equal(unassigned(snap,{...w1,idle:false},c,{unassignedSince:500},1000),null,'busy resets');
  w1.unassignedSince=1000;
  assert.equal(dispatch(snap,[o,w1,w2],c,{},300000).send,false,'not idle long enough');
  let d=dispatch(snap,[o,w1,w2],c,{},601000);assert.equal(d.send,true);assert.deepEqual(d.workers,['w1']);
  d.record.attempts=1;d.record.lastNudgeAt=601000;
  assert.equal(dispatch(snap,[o,w1,w2],c,d.record,700000).record.reason,'cooldown');
  assert.equal(dispatch(snap,[{...o,idle:false},w1,w2],c,{},601000).send,false,'dispatcher busy');
  assert.equal(dispatch(snap,[o,w1,w2],{...c,paused:true},{},601000).send,false);
  assert.equal(dispatch(snap,[o,w1,w2],{...c,dispatcher:undefined},{},601000).send,false);
  w2.unassignedSince=1000;assert.equal(dispatch(snap,[o,w1,w2],c,d.record,700000).send,true,'a newly idle worker is a new dispatch');
  const m=dispatchMessage(['w1','w2']);assert.match(m,/w1, w2/);assert.match(m,/Do not deploy publicly/);assert.ok(m.length<420,m.length);
});
