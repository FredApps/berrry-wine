'use strict';
function consumerBrowser(source) {
  const replace = (anchor, text) => { if (source.split(anchor).length !== 2) throw Error('unique browser anchor ' + anchor); source = source.replace(anchor, text); };
  replace("const {createLifecycle}=require('./lifecycle');", "const {createLifecycle}=require('./lifecycle');\nconst {checkedPreflightLaunch,matchingHttpPreflight}=require('./launch-preflight');");
  replace('browser=await lifecycle.acquire(()=>puppeteer.launch(', "browser=await checkedPreflightLaunch({check:()=>lifecycle.check(),receipt:r=>save('checked-preflight.json',r),preflight:()=>matchingHttpPreflight({plan,port:server.address().port,check:()=>lifecycle.check()}),launch:()=>lifecycle.acquire(()=>puppeteer.launch(");
  replace('protocolTimeout:15000,timeout:30000}));', 'protocolTimeout:15000,timeout:30000}))});');
  replace('finally{await pause(1500);receipt.workerArm', 'finally{await pause(6000);receipt.workerArm');
  replace('if(shotCount>=30||', 'if(shotCount>=8||');
  replace('captureBytes+image.length>60*1024**2', 'captureBytes+image.length>16*1024**2');
  replace('validate(c,{lastShot,deadline});let workerArm=[];', `validate(c,{lastShot,deadline});
 if(c.observe===true){
  if(!Number.isFinite(c.nativeX)||!Number.isFinite(c.nativeY))throw Error('current reviewed native point required');
  const target=await page.evaluate(c=>{const r=runningApps.find(a=>a.name==='tiberian_sun_demo')?.wine?.renderer,p=r?.windows[0x10002];if(!p?.visible)throw Error('expected current parent absent');const child=r._hitTestDeepChild(p,c.nativeX,c.nativeY);return{parent:p.hwnd,child:child?.hwnd||null,nativePoint:[c.nativeX,c.nativeY],scope:'read-only renderer/native window hit-test; no CPU state sample'};},c);
  save('pre-input-target.json',target);if(target.parent!==0x10002||target.child!==0x10004)throw Error('current reviewed parent/button mismatch');
 }
 let workerArm=[];`);
  return source;
}
module.exports = {consumerBrowser};
