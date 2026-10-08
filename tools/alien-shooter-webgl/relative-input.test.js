'use strict';
const assert=require('node:assert/strict');
const {validateRelative,desktop,installMotionObserver}=require('./relative-input');
async function main(){
 const ctx={lastShot:'hover',deadline:100000,now:1},c={action:'relative',dx:-200,dy:50,sceneReviewed:true,sceneReceipt:'hover'};
 validateRelative(c,ctx);
 for(const bad of [{dx:601},{dy:1.5},{dx:0,dy:0},{sceneReviewed:false},{sceneReceipt:'stale'}])assert.throws(()=>validateRelative({...c,...bad},ctx));
 assert.throws(()=>validateRelative(c,{...ctx,now:75001}));
 const click={...c,action:'desktopClick'};assert.throws(()=>validateRelative(click,ctx));validateRelative({...click,targetReviewed:true},ctx);
 let calls=0;const args=['mousemove_relative','--','-200','50'];await desktop(args,(bin,a,o,done)=>{calls++;assert.equal(bin,'/usr/bin/xdotool');assert.deepEqual(a,args);assert.equal(o.timeout,5000);done(null,'','')});assert.equal(calls,1);
 await assert.rejects(()=>desktop(args,(_b,_a,_o,done)=>done(Error('actual desktop failure'))));
 const listeners=new Map();global.document={pointerLockElement:{},addEventListener:(t,f,o)=>{assert.equal(o.passive,true);listeners.set(t,f)},removeEventListener:t=>listeners.delete(t)};
 installMotionObserver();for(let i=0;i<140;i++)listeners.get('mousemove')({isTrusted:true,type:'mousemove',movementX:-3,movementY:2,clientX:100,clientY:100,target:{tagName:'CANVAS'}});
 const r=global.__crimsonMotion.read();assert.equal(r.rows.length,128);assert.equal(r.total,140);assert.equal(r.capped,true);assert.equal(r.rows[0].movementX,-3);assert.equal(r.rows[0].trusted,true);global.__crimsonMotion.stop();assert.equal(listeners.size,0);delete global.__crimsonMotion;delete global.document;
 console.log('relative desktop validation, actual argv/error, bounded passive trusted DOM collection PASS');
}main().catch(e=>{console.error(e);process.exitCode=1});
